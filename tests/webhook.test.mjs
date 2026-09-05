import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { normalize, decodeImage, readBoundedBody, verifySignature } from '../supabase/functions/_shared/core.mjs';
import { createHandler, processMessage } from '../supabase/functions/_shared/handler.mjs';
import { adapters, settings } from '../supabase/functions/_shared/adapters.mjs';

const secret = 'test-only-secret-with-at-least-32-characters';
const config = { OPENWA_WEBHOOK_SECRET: secret, OPENWA_SESSION_ID: 'pilot', sendEnabled: true };
const payload = () => ({ event: 'message.received', sessionId: 'pilot', data: {
  id: 'message-1', chatId: '50370000000@c.us', fromMe: false, isGroup: false,
  body: 'Hola, ApartaYa', type: 'text', timestamp: 1788566400,
} });
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aAAAAABJRU5ErkJggg==';
function request(value = payload(), signature) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  return new Request('http://localhost/webhooks/messages', { method: 'POST', headers: {
    'content-type': 'application/json',
    'x-openwa-signature': signature ?? `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
  }, body });
}
function memoryDeps() {
  const state = { message: null, status: 'pending', sent: [], uploaded: [], accepted: 0 };
  return { state,
    async accept(message) { state.accepted++; state.message ??= message; return { id: 'receipt' }; },
    async claim() { if (!['pending','retry'].includes(state.status)) return null; state.status = 'processing'; return { token: 'lease', merchant_id: 'merchant', message: state.message }; },
    async markSending() { state.status = 'sending'; },
    async finish(id, token, status) { state.status = status; },
    async upload(path, image) { state.uploaded.push({ path, image }); },
    async send(chat, body) { state.sent.push({ chat, body }); },
  };
}
test('HMAC verifies exact bytes and rejects changed bytes, missing and malformed signatures', async () => {
  const body = new TextEncoder().encode('{ "a":1 }');
  const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(await verifySignature(body, sig, secret), true);
  assert.equal(await verifySignature(new TextEncoder().encode('{"a":1}'), sig, secret), false);
  for (const signature of [null, '', 'sha256=abc', sig.replace(/.$/, 'z')]) assert.equal(await verifySignature(body, signature, secret), false);
});
test('invalid signature produces no writes', async () => {
  const deps = memoryDeps();
  assert.equal((await createHandler(config, deps)(request(payload(), 'bad'))).status, 401);
  assert.equal(deps.state.accepted, 0);
});
test('same message delivered twice produces one reply', async () => {
  const deps = memoryDeps();
  const handler = createHandler(config, deps);
  assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(deps.state.sent, [{ chat: '50370000000@c.us', body: 'Hola, ApartaYa' }]);
});
test('parallel duplicate deliveries produce one reply', async () => {
  const deps = memoryDeps();
  const handler = createHandler(config, deps);
  await Promise.all([handler(request()), handler(request()), handler(request())]);
  assert.equal(deps.state.sent.length, 1);
});
test('groups, outgoing messages, unknown message types and broadcast are ignored', () => {
  for (const patch of [{ isGroup: true }, { fromMe: true }, { type: 'audio' }, { chatId: 'status@broadcast' }]) {
    const value = payload(); Object.assign(value.data, patch);
    assert.equal(normalize(value, 'pilot'), null);
  }
});
test('missing direction and wrong session fail validation; LID is preserved', () => {
  const value = payload(); delete value.data.fromMe;
  assert.throws(() => normalize(value, 'pilot'), /invalid_direction/);
  assert.throws(() => normalize(payload(), 'other'), /unexpected_session/);
  const lid = payload(); lid.data.chatId = '123456789@lid';
  assert.equal(normalize(lid, 'pilot').chatId, '123456789@lid');
});
test('image is uploaded before acknowledgment and before outbound send', async () => {
  const deps = memoryDeps();
  const value = payload(); value.data.type = 'image'; value.data.media = { mimetype: 'image/png', data: png };
  const handler = createHandler(config, deps);
  assert.equal((await handler(request(value))).status, 200);
  assert.equal(deps.state.uploaded[0].path, 'merchant/receipt.png');
  assert.equal(deps.state.sent[0].body, 'Foto recibida y guardada.');
});
test('unsupported or forged image content is rejected', () => {
  assert.throws(() => decodeImage({ mimetype: 'image/jpeg', data: png }), /image_type_mismatch/);
  assert.throws(() => decodeImage({ mimetype: 'image/svg+xml', data: png }), /invalid_image_type/);
  assert.throws(() => decodeImage({ mimetype: 'image/png', data: '!!!!' }), /invalid_base64/);
});
test('omitted image is acknowledged honestly without fetching arbitrary URLs', async () => {
  const deps = memoryDeps();
  const value = payload(); value.data.type = 'image'; value.data.media = { omitted: true, url: 'http://127.0.0.1/private' };
  await createHandler(config, deps)(request(value));
  assert.equal(deps.state.uploaded.length, 0);
  assert.match(deps.state.sent[0].body, /no llegó completa/);
});
test('storage failure is retryable and does not send success reply', async () => {
  const deps = memoryDeps(); deps.upload = async () => { throw new Error('offline'); };
  const value = payload(); value.data.type = 'image'; value.data.media = { mimetype: 'image/png', data: png };
  const response = await createHandler(config, deps)(request(value));
  assert.equal(response.status, 503);
  assert.equal(deps.state.status, 'retry'); assert.equal(deps.state.sent.length, 0);
});
test('ambiguous send enters review and is not repeated on retry', async () => {
  const deps = memoryDeps(); let sends = 0;
  deps.send = async () => { sends++; throw new Error('timeout after provider accepted'); };
  const handler = createHandler(config, deps);
  await handler(request()); await handler(request());
  assert.equal(deps.state.status, 'needs_review'); assert.equal(sends, 1);
});
test('disabled sending holds message without contacting WhatsApp', async () => {
  const deps = memoryDeps(); deps.state.message = normalize(payload(), 'pilot');
  assert.equal(await processMessage('receipt', deps, false), 'held');
  assert.equal(deps.state.sent.length, 0);
});
test('malformed JSON returns 400 and database failure 503', async () => {
  const deps = memoryDeps();
  const handler = createHandler(config, deps, { error() {} });
  assert.equal((await handler(request('{'))).status, 400);
  deps.accept = async () => { throw new Error('do not expose service credentials'); };
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /credentials/);
});
test('unknown paths and methods fail closed', async () => {
  const handler = createHandler(config, memoryDeps());
  assert.equal((await handler(new Request('http://localhost/webhooks/messages'))).status, 405);
  assert.equal((await handler(new Request('http://localhost/other'))).status, 404);
});
test('streaming body limit is enforced without content-length', async () => {
  await assert.rejects(() => readBoundedBody(new Request('http://localhost', { method: 'POST', body: '12345' }), 4), /body_too_large/);
});
test('configuration rejects missing secrets and remote cleartext endpoints', () => {
  assert.throws(() => settings(() => ''), /Missing configuration/);
  const values = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'key', OPENWA_BASE_URL: 'http://remote.example', OPENWA_API_KEY: 'key', OPENWA_SESSION_ID: 'pilot', OPENWA_WEBHOOK_SECRET: secret, WORKER_SECRET: secret };
  assert.throws(() => settings(name => values[name]), /HTTPS required/);
});
test('adapter uses provider REST contract and refuses redirects', async () => {
  const calls = [];
  const deps = adapters({ OPENWA_BASE_URL: 'https://gateway.example', OPENWA_SESSION_ID: 'pilot', OPENWA_API_KEY: 'secret' }, async (url, options) => {
    calls.push({ url, options }); return Response.json({ messageId: 'sent' });
  });
  await deps.send('50370000000@c.us', 'hola');
  assert.equal(calls[0].url, 'https://gateway.example/api/sessions/pilot/messages/send-text');
  assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].options.body), { chatId: '50370000000@c.us', text: 'hola' });
});

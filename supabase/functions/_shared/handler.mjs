import { decodeImage, InputError, normalize, readBoundedBody, replyFor, verifySignature } from './core.mjs';

export async function processMessage(id, deps, sendEnabled) {
  const job = await deps.claim(id);
  if (!job) return 'busy_or_completed';
  const { token, message, merchant_id: merchantId } = job;
  let sending = false;
  let path = null;
  try {
    if (message.media) {
      const image = decodeImage({ mimetype: message.media.mimetype, data: message.media.base64 });
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[image.mimetype];
      path = `${merchantId}/${id}.${extension}`;
      await deps.upload(path, image);
    }
    const reply = deps.processBot ? await deps.processBot(id, token, path, message) : replyFor(message);
    if (!sendEnabled) {
      await deps.finish(id, token, 'held', path);
      return 'held';
    }
    // Persist BEFORE external side effect. An ambiguous send is never blindly repeated.
    await deps.markSending(id, token);
    sending = true;
    await deps.send(message.chatId, reply);
    await deps.finish(id, token, 'done', path);
    return 'done';
  } catch {
    const status = sending ? 'needs_review' : 'retry';
    await deps.finish(id, token, status, path);
    return status;
  }
}

export function createHandler(config, deps, logger = console) {
  return async request => {
    const path = new URL(request.url).pathname;
    if (!['/webhooks/messages', '/functions/v1/webhooks/messages'].includes(path)) return Response.json({ error: 'not_found' }, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return Response.json({ error: 'json_required' }, { status: 415 });
    try {
      const raw = await readBoundedBody(request);
      if (!await verifySignature(raw, request.headers.get('x-openwa-signature'), config.OPENWA_WEBHOOK_SECRET)) return Response.json({ error: 'invalid_signature' }, { status: 401 });
      let payload;
      try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
      catch { throw new InputError('invalid_json'); }
      const message = normalize(payload, config.OPENWA_SESSION_ID);
      if (!message) return Response.json({ status: 'ignored' });
      const receipt = await deps.accept(message);
      const status = await processMessage(receipt.id, deps, config.sendEnabled);
      return Response.json({ status }, { status: status === 'retry' ? 503 : 200 });
    } catch (error) {
      if (error instanceof InputError) return Response.json({ error: error.message }, { status: error.message.endsWith('too_large') ? 413 : 400 });
      logger.error(JSON.stringify({ event: 'webhook_processing_failed' }));
      return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
    }
  };
}

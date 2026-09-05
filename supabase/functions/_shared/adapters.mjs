import { botCopy, hash, parsePrice } from './commerce.mjs';
export function settings(env) {
  const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENWA_BASE_URL', 'OPENWA_API_KEY', 'OPENWA_SESSION_ID', 'OPENWA_WEBHOOK_SECRET', 'WORKER_SECRET'];
  const config = Object.fromEntries(names.map(name => {
    const value = env(name);
    if (!value) throw new Error(`Missing configuration: ${name}`);
    return [name, value];
  }));
  if (config.OPENWA_WEBHOOK_SECRET.length < 32 || config.WORKER_SECRET.length < 32) throw new Error('Secrets must contain at least 32 characters');
  for (const name of ['SUPABASE_URL', 'OPENWA_BASE_URL']) {
    const url = new URL(config[name]);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(`Invalid base URL: ${name}`);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error(`HTTPS required: ${name}`);
    config[name] = url.origin;
  }
  config.sendEnabled = env('BOT_SEND_ENABLED') === 'true';
  config.botMode = env('BOT_MODE') ?? 'commerce';
  config.publicOrigin = env('PUBLIC_APP_ORIGIN') ?? 'http://localhost:3000';
  return config;
}

export function adapters(config, fetcher = fetch) {
  const dbHeaders = { apikey: config.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}` };
  async function rpc(name, args = {}) {
    const response = await fetcher(`${config.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { ...dbHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`database_${response.status}`);
    return response.json();
  }
  return {
    rpc,
    ...(config.botMode === 'commerce' ? { async processBot(id, token, path, message) {
      const match = /^(ENTREGADO|VINCULAR)\s+([A-Z0-9]+)$/i.exec(message.text.trim());
      const result = await rpc('process_bot', { p_receipt:id, p_token:token, p_image_path:path,
        p_price:parsePrice(message.text), p_code_hash:match ? await hash(match[2].toUpperCase()) : null });
      return botCopy(result, config.publicOrigin);
    } } : {}),
    accept: message => rpc('accept_message', { p_message: message }),
    claim: id => rpc('claim_message', { p_id: id }),
    finish: (id, token, status, path = null) => rpc('finish_message', { p_id: id, p_token: token, p_status: status, p_image_path: path }),
    markSending: (id, token) => rpc('mark_message_sending', { p_id: id, p_token: token }),
    pending: () => rpc('pending_messages', {}),
    async upload(path, image) {
      const response = await fetcher(`${config.SUPABASE_URL}/storage/v1/object/merchant-photos/${path}`, {
        method: 'POST', headers: { ...dbHeaders, 'Content-Type': image.mimetype, 'x-upsert': 'true' }, body: image.bytes,
        signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      if (!response.ok) throw new Error(`storage_${response.status}`);
    },
    async send(chatId, value) {
      const response = await fetcher(`${config.OPENWA_BASE_URL}/api/sessions/${encodeURIComponent(config.OPENWA_SESSION_ID)}/messages/send-text`, {
        method: 'POST', headers: { 'X-API-Key': config.OPENWA_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, text: value }), signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      if (!response.ok) throw new Error(`openwa_${response.status}`);
    },
  };
}

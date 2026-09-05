export class InputError extends Error {}
export const MAX_BODY = 8 * 1024 * 1024;
export const MAX_IMAGE = 5 * 1024 * 1024;
const encoder = new TextEncoder();

export async function verifySignature(bytes, signature, secret) {
  if (!secret || secret.length < 32 || !/^sha256=[a-f0-9]{64}$/.test(signature ?? '')) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const digest = Uint8Array.from(signature.slice(7).match(/../g), h => parseInt(h, 16));
  return crypto.subtle.verify('HMAC', key, digest, bytes);
}

export async function readBoundedBody(request, limit = MAX_BODY) {
  if (Number(request.headers.get('content-length')) > limit) throw new InputError('body_too_large');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new InputError('body_too_large'); }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function text(value, name, max = 256) {
  if (typeof value !== 'string' || !value || value.length > max) throw new InputError(`invalid_${name}`);
  return value;
}

/** OpenWA v0.23.3 -> NormalizedMessage. JIDs remain opaque identities, not phone numbers. */
export function normalize(payload, sessionId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new InputError('invalid_payload');
  if (text(payload.sessionId, 'session') !== sessionId) throw new InputError('unexpected_session');
  if (payload.event !== 'message.received') return null;
  const data = payload.data;
  if (!data || typeof data !== 'object') throw new InputError('invalid_message');
  if (typeof data.fromMe !== 'boolean' || typeof data.isGroup !== 'boolean') throw new InputError('invalid_direction');
  if (data.fromMe || data.isGroup) return null;
  const chatId = text(data.chatId, 'chat');
  if (!/^\d{5,20}@(c\.us|s\.whatsapp\.net|lid)$/.test(chatId)) return null;
  if (!['text', 'image'].includes(data.type)) return null;
  const messageId = text(data.id, 'message_id', 512);
  const body = data.body ?? '';
  if (typeof body !== 'string' || body.length > 4096) throw new InputError('invalid_text');
  if (!Number.isSafeInteger(data.timestamp) || data.timestamp < 0 || data.timestamp > 253402300799) throw new InputError('invalid_timestamp');
  const media = data.type === 'image' ? decodeImage(data.media) : null;
  return {
    sessionId, messageId, chatId, type: data.type, text: body,
    occurredAt: new Date(data.timestamp * 1000).toISOString(),
    // Do not retain the provider's full payload, contacts, or redundant inline image.
    media: media ? { mimetype: media.mimetype, base64: data.media.data } : null,
    mediaOmitted: data.type === 'image' && !media,
  };
}

export function decodeImage(media) {
  if (media?.omitted === true) return null;
  if (!media || typeof media.data !== 'string') throw new InputError('missing_image');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(media.mimetype)) throw new InputError('invalid_image_type');
  if (media.data.length > Math.ceil(MAX_IMAGE / 3) * 4) throw new InputError('image_too_large');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(media.data)) throw new InputError('invalid_base64');
  const bytes = Uint8Array.from(atob(media.data), c => c.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_IMAGE) throw new InputError('image_too_large');
  const isJpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const isPng = [137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n);
  const isWebp = String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  if (!(media.mimetype === 'image/jpeg' && isJpeg || media.mimetype === 'image/png' && isPng || media.mimetype === 'image/webp' && isWebp)) throw new InputError('image_type_mismatch');
  return { bytes, mimetype: media.mimetype };
}

export function replyFor(message) {
  if (message.type === 'text') return message.text || 'Recibí tu mensaje.';
  if (message.mediaOmitted) return 'La foto no llegó completa. Por favor, enviala comprimida y de menos de 5 MB.';
  return 'Foto recibida y guardada.';
}

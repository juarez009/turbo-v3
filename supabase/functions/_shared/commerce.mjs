export const money = cents => `$${(Number(cents) / 100).toFixed(2)}`;
export function parsePrice(value) {
  const match = /^\$?(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}
export async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
}
export function newCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  // Rejection sampling avoids modulo bias for a non-power-of-two alphabet.
  let code = '';
  while (code.length < 8) for (const n of crypto.getRandomValues(new Uint8Array(16))) {
    if (n < Math.floor(256 / alphabet.length) * alphabet.length && code.length < 8) code += alphabet[n % alphabet.length];
  }
  return code;
}
async function encryptionKey(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret ?? '')) throw new Error('PICKUP_ENCRYPTION_KEY must be 32 bytes of hex');
  return crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g), n => parseInt(n,16)), 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function encryptCode(code, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv }, await encryptionKey(secret), new TextEncoder().encode(code)));
  return btoa(String.fromCharCode(...iv,...encrypted));
}
export async function decryptCode(value, secret) {
  const bytes = Uint8Array.from(atob(value), c=>c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name:'AES-GCM', iv:bytes.slice(0,12) }, await encryptionKey(secret), bytes.slice(12)));
}
export function salesCopy(s) {
  return `Hoy, ${s.date}: ${s.reserved} apartados, ${s.delivered} entregados y ${s.expired} vencidos. Señas confirmadas: ${money(s.deposits)}. Pagos en revisión: ${s.review}. El reporte de liquidación muestra lo pendiente de transferir.`;
}
export function botCopy(result, origin) {
  const copy = {
    onboarding:'¡Hola! Para publicar con ApartaYa, primero completá el registro con nuestro equipo.',
    rate_limited:'Recibimos varios intentos. Esperá unos minutos antes de volver a intentar.',
    help:'Mandá una foto y después el precio para publicar.\nPUNTO: cambiar lugar de retiro.\nVENTAS: ver el resumen del día.\nENTREGADO código: confirmar un retiro.\nCANCELAR: salir del borrador actual.',
    ask_point:'Escribí la dirección y una referencia corta del lugar de retiro. Esta información aparecerá en tus publicaciones.',
    point_cancelled:'Cancelé el cambio de punto. Tu borrador sigue disponible.',
    cancelled:'Borrador cancelado. Cuando quieras publicar, mandame otra foto.',
    no_draft:'No tenés un borrador pendiente.',
    ask_code:'Escribí ENTREGADO seguido del código que te muestre el comprador.',
    invalid_code:'No pude confirmar una reserva tuya con ese código. Revisalo con el comprador.',
    expired_code:'El apartado ya venció. Contactá a operaciones para revisar este retiro.',
    delivered:'Entrega confirmada. Ya quedó registrada en tus ventas.',
    already_delivered:'Esta entrega ya estaba confirmada. No la registré otra vez.',
    image_missing:'La foto no llegó completa. Por favor, enviala comprimida y de menos de 5 MB.',
    photo_replaced:'Cambié la foto del borrador. Ahora mandame el precio en dólares.',
    ask_price:'¡Ya tengo la foto! ¿Cuál es el precio en dólares? Escribí, por ejemplo: 12.50.',
    invalid_price:'No pude leer el precio. Escribilo en dólares, por ejemplo: 12.50. Para salir, escribí CANCELAR.',
    price_range:'Para este piloto, el precio debe estar entre $1.00 y $1,000.00. Mandame otro precio.',
    missing_point:'Antes de publicar, indicá dónde se retira. Escribí PUNTO y seguí las instrucciones.',
    idle:'Para publicar, mandame una foto del artículo. También podés escribir AYUDA.',
    linked:'Tu WhatsApp quedó vinculado. Volvé al enlace del artículo para continuar con tu apartado.',
    invalid_link:'No pude vincular este número. Generá otro enlace desde tu cuenta y mandalo desde el mismo número que verificaste.',
  };
  if (result.kind==='point_saved') return `Punto de retiro actualizado: ${result.point}.`;
  if (result.kind==='sales') return salesCopy(result.summary);
  if (result.kind==='published') {
    const url = `${origin}/${result.slug}`;
    return `¡Listo! Tu artículo está publicado.\nPrecio: ${money(result.price)}\nSeña: ${money(result.deposit)}\nSaldo al retirar: ${money(result.price-result.deposit)}\n${url}\n\nReenviá este texto:\nApartá este artículo por ${money(result.deposit)}. Precio total: ${money(result.price)}. Retiro en ${result.point}. Mirá las condiciones y reservá aquí: ${url}`;
  }
  return copy[result.kind] ?? 'No pude completar la solicitud. Intentá de nuevo.';
}
export async function noticeCopy(notice, context, secret, origin) {
  if (notice.template==='daily_summary') return salesCopy(context.summary);
  const o = context.order;
  const deadline = new Intl.DateTimeFormat('es-SV',{timeZone:'America/El_Salvador',dateStyle:'short',timeStyle:'short'}).format(new Date(o.pickup_expires_at));
  if (notice.template==='reserved_merchant') return `¡Tenés un apartado! Artículo: ${context.label}. ${o.payment_method==='cod'?'Reserva sin seña autorizada':`Seña confirmada: ${money(o.deposit_cents)}`}. Retiro antes de ${deadline}. Al entregar, pedile el código al comprador y escribí ENTREGADO seguido del código.`;
  if (notice.template==='expired_merchant') return `Venció el apartado de ${context.label}. ${context.available?'El artículo volvió a estar disponible.':'Revisá el estado del artículo.'} Revisá la seña en el reporte de conciliación.`;
  if (notice.template==='expired_buyer') return `Venció el plazo de tu apartado de ${context.label}. Revisá el estado de tu seña en ${origin}/pedidos/${o.id}.`;
  const code = await decryptCode(o.pickup_code_ciphertext,secret);
  if (notice.template==='reminder') return `Tu apartado vence el ${deadline}. Retirá en ${o.pickup_point}. Saldo: ${money(o.price_cents-o.deposit_cents)}. Código: ${code}.`;
  return `Tu apartado está confirmado. Código de retiro: ${code}. Retirá en ${o.pickup_point} antes de ${deadline}. Saldo al retirar: ${money(o.price_cents-o.deposit_cents)}. Mostrá el código al recibir el artículo.`;
}

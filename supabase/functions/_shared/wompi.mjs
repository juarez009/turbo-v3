// Wompi El Salvador contracts: docs.wompi.sv (see docs/wompi-sv.md).
import { InputError } from './core.mjs';
export async function verifyWompi(raw, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature ?? '')) return false;
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.match(/../g),n=>parseInt(n,16)),raw);
}
export function cents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value<=0 || value>1000) throw new InputError('invalid_amount');
  const n = Math.round(value*100);
  if (Math.abs(n-value*100)>0.000001) throw new InputError('invalid_amount_precision');
  return n;
}
export function normalizeWompi(payload, config) {
  if (payload?.Aplicativo?.Id !== config.WOMPI_CLIENT_ID || payload.EsProductiva !== config.live) throw new InputError('unexpected_payment_environment');
  if (payload.ResultadoTransaccion !== 'ExitosaAprobada') return null;
  if (payload.Cantidad !== 1) throw new InputError('unexpected_quantity');
  const orderId = payload.EnlacePago?.IdentificadorEnlaceComercio;
  if (!/^[a-f0-9-]{36}$/i.test(orderId ?? '') || typeof payload.IdTransaccion!=='string' || payload.IdTransaccion.length>128 || !payload.IdTransaccion || !Number.isSafeInteger(payload.EnlacePago?.Id)) throw new InputError('invalid_payment_identity');
  return { p_order:orderId,p_ref:payload.IdTransaccion,p_link:String(payload.EnlacePago.Id),p_amount:cents(payload.Monto),p_currency:'USD',p_status:'approved' };
}
export function wompiClient(config, fetcher=fetch) {
  let token; let expires=0;
  async function api(path, body) {
    if (!config.WOMPI_CLIENT_ID || !config.WOMPI_CLIENT_SECRET) throw new Error('Payments not configured');
    if (!token || Date.now()>=expires) {
      const r = await fetcher('https://id.wompi.sv/connect/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'client_credentials',audience:'wompi_api',client_id:config.WOMPI_CLIENT_ID,client_secret:config.WOMPI_CLIENT_SECRET}),redirect:'error',signal:AbortSignal.timeout(8000)});
      if (!r.ok) throw new Error('Payment authentication failed');
      const data = await r.json(); if (!data.access_token) throw new Error('Invalid token response');
      token=data.access_token; expires=Date.now()+Math.max(0,(Number(data.expires_in)||0)-60)*1000;
    }
    const r = await fetcher(`https://api.wompi.sv${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!r.ok) throw new Error('Payment provider unavailable');
    return r.json();
  }
  return {
    async createCheckout(order) {
      const data = await api('/EnlacePago',{
        identificadorEnlaceComercio:order.id,monto:order.deposit_cents/100,nombreProducto:'Seña ApartaYa',
        formaPago:{permitirTarjetaCreditoDebido:true,permitirPagoConPuntoAgricola:false,permitirPagoEnCuotasAgricola:false,permitirPagoEnBitcoin:false,permitePagoQuickPay:false},
        configuracion:{urlWebhook:`${config.SUPABASE_URL}/functions/v1/webhooks/wompi`,urlRedirect:`${config.publicOrigin}/pedidos/${order.id}`,
          urlRetorno:`${config.publicOrigin}/pedidos/${order.id}`,esMontoEditable:false,esCantidadEditable:false,cantidadPorDefecto:1,duracionInterfazIntentoMinutos:15,notificarTransaccionCliente:true},
        vigencia:{fechaInicio:order.created_at,fechaFin:order.checkout_expires_at},limitesDeUso:{cantidadMaximaPagosExitosos:1},
      });
      const url = new URL(data.urlEnlace);
      if (url.protocol!=='https:' || !['lk.wompi.sv','wompi.sv'].includes(url.hostname) || !Number.isSafeInteger(data.idEnlace) || data.estaProductivo!==config.live) throw new Error('Unexpected checkout response');
      return {id:String(data.idEnlace),url:url.href};
    },
    fetchPayment: id => api(`/TransaccionCompra/${encodeURIComponent(id)}`),
  };
}

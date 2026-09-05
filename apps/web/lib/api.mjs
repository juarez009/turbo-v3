export const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
export const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export async function api(path,{token,method='GET',body,key}={}){
  if(!base||!anon)throw new Error('El servicio todavía no está configurado.');
  const endpoint=path==='orders'&&method==='POST'?'/api/orders':`${base}/functions/v1/${path}`;
  const r=await fetch(endpoint,{method,headers:{apikey:anon,...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
  const data=await r.json();if(!r.ok){const errors={request_conflict:'El artículo ya no está disponible o la solicitud cambió. Revisá tu pedido antes de intentar otra vez.',payments_unavailable:'Los pagos todavía no están disponibles.',authentication_required:'Verificá tu número para continuar.',verified_phone_required:'Necesitás un número de El Salvador verificado.',whatsapp_link_required:'Vinculá tu WhatsApp antes de apartar.',channel_not_configured:'El canal de WhatsApp todavía no está disponible.',forbidden:'Esta cuenta no tiene acceso a operaciones.'};throw new Error(errors[data.error]??'No pudimos completar la solicitud. Intentá de nuevo en un momento.');}return data;
}

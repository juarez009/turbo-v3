import { InputError, readBoundedBody } from './core.mjs';
import { decryptCode, encryptCode, hash, newCode } from './commerce.mjs';
import { normalizeWompi, verifyWompi, wompiClient } from './wompi.mjs';

export function appConfig(env) {
  const config = Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','WOMPI_CLIENT_ID','WOMPI_CLIENT_SECRET','PICKUP_ENCRYPTION_KEY','WORKER_SECRET','BOT_PHONE'].map(k=>[k,env(k)]));
  config.publicOrigin=env('PUBLIC_APP_ORIGIN')??'http://localhost:3000';
  config.paymentsEnabled=env('PAYMENTS_ENABLED')==='true'; config.live=env('WOMPI_LIVE')==='true';
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Database configuration required');
  for(const key of ['SUPABASE_URL','publicOrigin']) {
    const url=new URL(config[key]);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||
      !(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new Error(`Invalid base URL: ${key}`);
    config[key]=url.origin;
  }
  if(config.paymentsEnabled&&(!config.WOMPI_CLIENT_ID||!config.WOMPI_CLIENT_SECRET||!config.publicOrigin.startsWith('https://')||!config.SUPABASE_URL.startsWith('https://')||!/^[a-f0-9]{64}$/i.test(config.PICKUP_ENCRYPTION_KEY??'')))throw new Error('Payment configuration incomplete');
  return config;
}
export function appStore(config, fetcher=fetch) {
  const headers={apikey:config.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
  async function rest(path,options={}) {
    const r=await fetcher(`${config.SUPABASE_URL}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers},redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!r.ok) {
      const data=await r.json().catch(()=>({}));
      // Never expose raw database messages to clients.
      const error=new Error('Database request failed'); error.reason=data.message; throw error;
    }
    return r.status===204?null:r.json();
  }
  return {
    rpc:(name,args={})=>rest(`rpc/${name}`,{method:'POST',body:JSON.stringify(args)}),
    rows:(table,query)=>rest(`${table}?${new URLSearchParams(query)}`),
    patch:(table,id,body)=>rest(`${table}?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(body)}),
    async user(token) {
      if (!token) return null;
      const r=await fetcher(`${config.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:config.SUPABASE_ANON_KEY??config.SUPABASE_SERVICE_ROLE_KEY,Authorization:token},redirect:'error',signal:AbortSignal.timeout(8000)});
      return r.ok?r.json():null;
    },
    async image(path) {
      const r=await fetcher(`${config.SUPABASE_URL}/storage/v1/object/sign/merchant-photos/${path.split('/').map(encodeURIComponent).join('/')}`,{
        method:'POST',headers,body:JSON.stringify({expiresIn:300}),redirect:'error',signal:AbortSignal.timeout(8000)});
      if (!r.ok) return null;
      const data=await r.json(); return `${config.SUPABASE_URL}/storage/v1${data.signedURL}`;
    },
  };
}
const uuid = value => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const safeOrder = o => ({id:o.id,status:o.status,paymentMethod:o.payment_method,price:o.price_cents,deposit:o.deposit_cents,pickupPoint:o.pickup_point,
  deadline:o.pickup_expires_at,checkoutDeadline:o.checkout_expires_at,checkoutState:o.checkout_state,
  checkoutUrl:o.status==='pending_payment'&&Date.parse(o.checkout_expires_at)>Date.now()?o.checkout_url:null});

export function createApp(config,store=appStore(config),payments=wompiClient(config)) {
  return async request => {
    const cors={'Access-Control-Allow-Origin':config.publicOrigin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,idempotency-key','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
    const response=(body,status=200)=>Response.json(body,{status,headers:cors});
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
    const path=new URL(request.url).pathname.replace(/^\/functions\/v1/,'');
    try {
      if (path==='/webhooks/wompi') {
        if(request.method!=='POST')return response({error:'method_not_allowed'},405);
        const raw=await readBoundedBody(request,65536);
        if(!await verifyWompi(raw,request.headers.get('wompi_hash'),config.WOMPI_CLIENT_SECRET))return response({error:'invalid_signature'},401);
        const payment=normalizeWompi(JSON.parse(new TextDecoder().decode(raw)),config);
        return response(payment?await store.rpc('apply_payment',payment):{status:'ignored'});
      }
      if(path==='/listings'&&request.method==='GET') {
        const slug=new URL(request.url).searchParams.get('slug');
        if(!/^[a-zA-Z0-9_-]{12,64}$/.test(slug??''))return response({error:'not_found'},404);
        if(!await store.rpc('take_rate',{p_key:'public-listings',p_limit:2000,p_seconds:60}))return response({error:'rate_limited'},429);
        const [l]=await store.rows('listings',{slug:`eq.${slug}`,select:'id,merchant_id,slug,label,image_path,price_cents,deposit_cents,pickup_point,status'});
        if(!l)return response({error:'not_found'},404);
        const [m]=await store.rows('merchants',{id:`eq.${l.merchant_id}`,select:'enabled,display_name'});
        if(!m?.enabled||l.status==='disabled')return response({error:'not_found'},404);
        return response({slug:l.slug,label:l.label,merchant:m.display_name??'Comerciante ApartaYa',price:l.price_cents,deposit:l.deposit_cents,pickupPoint:l.pickup_point,
          status:l.status,imageUrl:await store.image(l.image_path),paymentsEnabled:config.paymentsEnabled});
      }
      const user=await store.user(request.headers.get('authorization'));
      if(!user?.id)return response({error:'authentication_required'},401);
      if(!await store.rpc('take_rate',{p_key:`api:${user.id}`,p_limit:120,p_seconds:60}))return response({error:'rate_limited'},429);
      const isOps=user.app_metadata?.role==='ops';
      if(path==='/operations') {
        if(!isOps)return response({error:'forbidden'},403);
        if(request.method==='GET')return response(await store.rpc('operations_report'));
        if(request.method!=='POST')return response({error:'method_not_allowed'},405);
        const body=JSON.parse(new TextDecoder().decode(await readBoundedBody(request,4096)));
        if(body.action==='enable'&&uuid(body.merchantId)&&typeof body.name==='string'&&body.name.trim().length>=2&&body.name.length<=80)
          return response(await store.rpc('enable_merchant',{p_id:body.merchantId,p_name:body.name.trim()}));
        if(body.action==='fee'&&uuid(body.orderId)&&Number.isInteger(body.feeCents)&&body.feeCents>=0&&body.feeCents<=100000)
          return response(await store.rpc('record_fee',{p_order:body.orderId,p_fee:body.feeCents,p_reference:String(body.reference??'').slice(0,128)}));
        return response({error:'invalid_action'},400);
      }
      if(!user.phone_confirmed_at||!/^\+?503\d{8}$/.test(user.phone??''))return response({error:'verified_phone_required'},403);
      const buyer=await store.rpc('buyer_identity',{p_auth:user.id,p_phone:`+${user.phone.replace(/^\+/,'')}`});
      if(path==='/account'&&request.method==='GET') {
        const [cfg]=await store.rows('pilot_settings',{select:'cod_enabled'});
        return response({linked:!!buyer.chat_verified_at,codEligible:!!cfg?.cod_enabled&&buyer.score>=80&&buyer.delivered_count>=3});
      }
      if(path==='/account'&&request.method==='POST') {
        if(!/^503\d{8}$/.test(config.BOT_PHONE??''))return response({error:'channel_not_configured'},503);
        const token=crypto.randomUUID().replaceAll('-','').toUpperCase();
        await store.rpc('create_chat_link',{p_buyer:buyer.id,p_hash:await hash(token)});
        return response({url:`https://wa.me/${config.BOT_PHONE}?text=${encodeURIComponent(`VINCULAR ${token}`)}`});
      }
      if(path==='/orders'&&request.method==='GET') {
        const id=new URL(request.url).searchParams.get('id'); if(!uuid(id))return response({error:'not_found'},404);
        const [o]=await store.rows('orders',{id:`eq.${id}`,buyer_id:`eq.${buyer.id}`,select:'*'});
        if(!o)return response({error:'not_found'},404);
        const [listing]=await store.rows('listings',{id:`eq.${o.listing_id}`,select:'slug'});
        const transactions=await store.rows('payment_transactions',{order_id:`eq.${o.id}`,select:'status'});
        const hasMoneyOrUncertainty=transactions.some(t=>['pending','approved','review'].includes(t.status));
        const canRetry=(o.status==='payment_failed'||(o.status==='expired'&&o.expiry_reason==='checkout_timeout'))&&!hasMoneyOrUncertainty;
        return response({...safeOrder(o),listingSlug:listing?.slug,canRetry,paymentReview:transactions.some(t=>t.status==='review'),
          ...(o.status==='reserved'&&Date.parse(o.pickup_expires_at)>Date.now()?{pickupCode:await decryptCode(o.pickup_code_ciphertext,config.PICKUP_ENCRYPTION_KEY)}:{})});
      }
      if(path==='/orders'&&request.method==='POST') {
        const body=JSON.parse(new TextDecoder().decode(await readBoundedBody(request,4096)));
        const key=request.headers.get('idempotency-key');
        if(!/^[a-zA-Z0-9_-]{12,64}$/.test(body.slug??'')||!['deposit','cod'].includes(body.method)||!/^[-a-zA-Z0-9_]{16,128}$/.test(key??'')||body.acceptTerms!==true)return response({error:'invalid_order'},400);
        if(body.method==='deposit'&&(!config.paymentsEnabled||!config.WOMPI_CLIENT_ID||!config.WOMPI_CLIENT_SECRET))return response({error:'payments_unavailable'},503);
        if(!buyer.chat_verified_at)return response({error:'whatsapp_link_required'},403);
        const code=newCode();
        const order=await store.rpc('reserve_order',{p_buyer:buyer.id,p_slug:body.slug,p_key:key,p_method:body.method,p_code_hash:await hash(code),p_code_ciphertext:await encryptCode(code,config.PICKUP_ENCRYPTION_KEY)});
        if(order.status==='pending_payment'&&!order.checkout_url&&await store.rpc('claim_checkout',{p_order:order.id})) {
          try { const checkout=await payments.createCheckout(order);
            await store.rpc('save_checkout',{p_order:order.id,p_provider_id:checkout.id,p_url:checkout.url});
            order.checkout_url=checkout.url;order.checkout_state='ready';
          } catch { await store.patch('orders',order.id,{checkout_state:'review'}); order.checkout_state='review'; }
        }
        return response(safeOrder(order),201);
      }
      return response({error:'not_found'},404);
    } catch(error) {
      if(error instanceof InputError||error instanceof SyntaxError)return response({error:error instanceof InputError?error.message:'invalid_json'},400);
      const conflict=['Listing unavailable','Idempotency conflict','Cash on delivery unavailable','Rate limited','Identity change requires review'].includes(error.reason);
      console.error(JSON.stringify({event:'application_request_failed',path}));
      return response({error:conflict?'request_conflict':'temporarily_unavailable'},conflict?409:503);
    }
  };
}

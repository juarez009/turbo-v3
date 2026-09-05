import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {normalizeWompi,verifyWompi,wompiClient,cents} from '../supabase/functions/_shared/wompi.mjs';
import {createApp} from '../supabase/functions/_shared/app.mjs';
import {encryptCode,decryptCode,newCode,parsePrice,botCopy} from '../supabase/functions/_shared/commerce.mjs';
const config={WOMPI_CLIENT_ID:'app-test',WOMPI_CLIENT_SECRET:'provider-test-secret',live:false,publicOrigin:'https://apartaya.example',SUPABASE_URL:'https://database.example'};
const payload={Aplicativo:{Id:'app-test'},EsProductiva:false,ResultadoTransaccion:'ExitosaAprobada',Cantidad:1,Monto:2.5,IdTransaccion:'transaction-1',EnlacePago:{Id:4,IdentificadorEnlaceComercio:'00000000-0000-4000-8000-000000000001'}};
test('SV Wompi raw HMAC, application, environment, quantity and amount validation',async()=>{
 const raw=new TextEncoder().encode(JSON.stringify(payload));const signature=createHmac('sha256',config.WOMPI_CLIENT_SECRET).update(raw).digest('hex');
 assert.equal(await verifyWompi(raw,signature,config.WOMPI_CLIENT_SECRET),true);
 assert.equal(await verifyWompi(new TextEncoder().encode(JSON.stringify({...payload,Monto:0.01})),signature,config.WOMPI_CLIENT_SECRET),false);
 assert.equal(normalizeWompi(payload,config).p_amount,250);
 assert.throws(()=>normalizeWompi({...payload,EsProductiva:true},config),/environment/);
 assert.throws(()=>normalizeWompi({...payload,Cantidad:2},config),/quantity/);
 assert.throws(()=>cents(1.001),/precision/);
});
test('encrypted pickup code roundtrip and strictly parsed USD price',async()=>{
 const key='ab'.repeat(32),code=newCode(),ciphertext=await encryptCode(code,key);
 assert.equal(code.length,8);assert.equal(await decryptCode(ciphertext,key),code);assert.notEqual(ciphertext,code);
 await assert.rejects(decryptCode(ciphertext,'cd'.repeat(32)));
 assert.equal(parsePrice('$12.50'),1250);assert.equal(parsePrice('12.5'),1250);assert.equal(parsePrice('1e3'),null);assert.equal(parsePrice('1,000'),null);assert.equal(parsePrice('12.500'),null);
 assert.match(botCopy({kind:'published',slug:'abc',price:1250,deposit:250,point:'Puesto 1'},'https://apartaya.example'),/\$10.00/);
});
test('checkout sends SV contract, non-editable deposit, one payment and validity',async()=>{
 const calls=[];
 const client=wompiClient(config,async(url,options)=>{calls.push({url,options});return Response.json(url.includes('connect/token')?{access_token:'test',expires_in:3600}:{idEnlace:4,urlEnlace:'https://lk.wompi.sv/abcd',estaProductivo:false})});
 const order={id:'order-id',deposit_cents:250,created_at:new Date().toISOString(),checkout_expires_at:new Date(Date.now()+900000).toISOString()};
 await client.createCheckout(order);
 const body=JSON.parse(calls[1].options.body);
 assert.equal(calls[0].url,'https://id.wompi.sv/connect/token');assert.equal(body.monto,2.5);assert.equal(body.configuracion.esMontoEditable,false);assert.equal(body.limitesDeUso.cantidadMaximaPagosExitosos,1);
 assert.equal(body.configuracion.urlWebhook,'https://database.example/functions/v1/webhooks/wompi');
 assert.equal(body.vigencia.fechaFin,order.checkout_expires_at);
});
test('webhook rejects forged events before database, accepts authenticated SV callback',async()=>{
 const calls=[];const app=createApp(config,{rpc:async(name,args)=>{calls.push({name,args});return {status:'reserved'}}});
 const body=JSON.stringify(payload),signature=createHmac('sha256',config.WOMPI_CLIENT_SECRET).update(body).digest('hex');
 const req=sig=>new Request('https://database.example/functions/v1/webhooks/wompi',{method:'POST',headers:{'wompi_hash':sig},body});
 assert.equal((await app(req('invalid'))).status,401);assert.equal(calls.length,0);
 assert.equal((await app(req(signature))).status,200);assert.equal(calls[0].args.p_amount,250);
});
test('operations authorization reads server-owned app_metadata, not user_metadata',async()=>{
 const app=createApp(config,{user:async()=>({id:'user',user_metadata:{role:'ops'}}),rpc:(name)=>{assert.equal(name,'take_rate');return true}});
 assert.equal((await app(new Request('https://database.example/functions/v1/operations'))).status,403);
});
test('unconfigured payments never reserve inventory',async()=>{
 const user={id:'user',phone:'50370000000',phone_confirmed_at:'2026-09-04'};
 const app=createApp({...config,paymentsEnabled:false},{user:async()=>user,rpc:async(name)=>{if(name==='take_rate')return true;assert.equal(name,'buyer_identity');return {id:'buyer',chat_verified_at:'now'}}});
 const r=await app(new Request('https://database.example/functions/v1/orders',{method:'POST',headers:{'idempotency-key':'checkout-key-0001'},body:JSON.stringify({slug:'abcdefghijklmnop',method:'deposit',acceptTerms:true})}));
 assert.equal(r.status,503);assert.equal((await r.json()).error,'payments_unavailable');
});

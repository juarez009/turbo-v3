import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp,appConfig} from '../supabase/functions/_shared/app.mjs';
const config={publicOrigin:'https://apartaya.example',paymentsEnabled:false};
const user={id:'auth-user',phone:'50370000000',phone_confirmed_at:'2026-09-04'};
const id='00000000-0000-4000-8000-000000000001';
test('public listing exposes a minimal projection, never merchant identity/contact or storage path',async()=>{
 const app=createApp(config,{rpc:async()=>true,rows:async(table)=>table==='listings'?[{id,merchant_id:'private-id',slug:'abcdefghijklmnop',label:'Artículo',image_path:'private/photo.png',price_cents:1250,deposit_cents:250,pickup_point:'Puesto 1',status:'available'}]:[{enabled:true,display_name:'Comercio',chat_id:'private-phone'}],image:async()=> 'https://storage.example/signed-image'});
 const r=await app(new Request('https://edge.example/functions/v1/listings?slug=abcdefghijklmnop'));assert.equal(r.status,200);
 const body=await r.json();assert.equal(body.deposit,250);
 assert.doesNotMatch(JSON.stringify(body),/private-id|private-phone|private\/photo/);
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('public read budget rejects requests without reading listings',async()=>{
 const app=createApp(config,{rpc:async()=>false,rows:()=>{throw new Error('should not query')}});
 assert.equal((await app(new Request('https://edge.example/functions/v1/listings?slug=abcdefghijklmnop'))).status,429);
});
test('order read is scoped to the verified buyer, not just the URL id',async()=>{
 const app=createApp(config,{user:async()=>user,rpc:async(name)=>name==='take_rate'?true:{id:'buyer-id'},rows:async(table,query)=>{
   assert.equal(table,'orders');assert.equal(query.buyer_id,'eq.buyer-id');return [];
 }});
 assert.equal((await app(new Request(`https://edge.example/functions/v1/orders?id=${id}`))).status,404);
});
test('a failed unpaid checkout can be retried; uncertain paid attempts cannot',async()=>{
 async function run(statuses){
  const app=createApp(config,{user:async()=>user,rpc:async(name)=>name==='take_rate'?true:{id:'buyer-id'},rows:async(table)=>{
   if(table==='orders')return [{id,listing_id:'listing',status:'expired',expiry_reason:'checkout_timeout',price_cents:1250,deposit_cents:250,payment_method:'deposit'}];
   if(table==='listings')return [{slug:'abcdefghijklmnop'}];
   return statuses.map(status=>({status}));
  }});
  return (await app(new Request(`https://edge.example/functions/v1/orders?id=${id}`))).json();
 }
 assert.equal((await run([])).canRetry,true);
 assert.equal((await run(['failed'])).canRetry,true);
 for(const state of ['pending','approved','review'])assert.equal((await run([state])).canRetry,false);
});
test('configuration rejects remote cleartext and incomplete live payment settings',()=>{
 const values={SUPABASE_URL:'http://remote.example',SUPABASE_SERVICE_ROLE_KEY:'server-secret'};
 assert.throws(()=>appConfig(k=>values[k]),/Invalid base URL/);
 values.SUPABASE_URL='https://project.supabase.co';values.PAYMENTS_ENABLED='true';
 assert.throws(()=>appConfig(k=>values[k]),/Payment configuration incomplete/);
});

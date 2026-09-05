import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {hash} from '../supabase/functions/_shared/commerce.mjs';

async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 for(const file of (await readdir('supabase/migrations')).sort())await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
 const rpc=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0]?.result;
 return {db,rpc};
}
test('merchant photo → price → point → unique listing; help and cancellation preserve context',async()=>{
 const {db,rpc}=await setup();
 try{
  let seq=0;
  async function bot(text,type='text',image=null,price=null,codeHash=null){
   const message={sessionId:'pilot',messageId:String(++seq),chatId:'50370000000@c.us',type,text};
   const {id}=await rpc('accept_message',[JSON.stringify(message)]);
   const job=await rpc('claim_message',[id]);
   const result=await rpc('process_bot',[id,job.token,image,price,codeHash]);
   await rpc('finish_message',[id,job.token,'done',image]);
   return {result,id,job};
  }
  assert.equal((await bot('hola')).result.kind,'onboarding');
  const merchant=(await db.query('select id from public.merchants')).rows[0].id;
  await rpc('enable_merchant',[merchant,'Comercio semilla']);
  assert.equal((await bot('', 'image', `${merchant}/photo.png`)).result.kind,'ask_price');
  assert.equal((await bot('AYUDA')).result.kind,'help');
  assert.equal((await bot('1e3')).result.kind,'invalid_price');
  assert.equal((await bot('12.50','text',null,1250)).result.kind,'missing_point');
  assert.equal((await bot('PUNTO')).result.kind,'ask_point');
  const published=await bot('Puesto 10, entrada norte');
  assert.equal(published.result.kind,'published');assert.equal(published.result.deposit,250);
  // A replay returns the stored result, even if the original lease has finished.
  assert.deepEqual(await rpc('process_bot',[published.id,published.job.token,null,null,null]),published.result);
  assert.equal((await db.query('select count(*)::int as n from public.listings')).rows[0].n,1);
  assert.equal((await bot('', 'image',`${merchant}/another.png`)).result.kind,'ask_price');
  await bot('PUNTO');assert.equal((await bot('CANCELAR')).result.kind,'point_cancelled');
  assert.equal((await db.query('select state from public.bot_sessions')).rows[0].state,'AWAITING_PRICE');
  assert.equal((await bot('CANCELAR')).result.kind,'cancelled');
 }finally{await db.close()}
});

test('payment lifecycle: duplicate checkout, late callback, no-show, delivery, score and subsidy',async()=>{
 const {db,rpc}=await setup();
 try{
  const merchant=(await db.query("insert into public.merchants(chat_id,enabled,pickup_point) values('50370000000@c.us',true,'Puesto 1') returning id")).rows[0].id;
  const buyer=(await rpc('buyer_identity',[crypto.randomUUID(),'+50370000001'])).id;
  const buyer2=(await rpc('buyer_identity',[crypto.randomUUID(),'+50370000002'])).id;
  async function link(id,phone){const h=await hash(crypto.randomUUID());await rpc('create_chat_link',[id,h]);assert.equal(await rpc('consume_chat_link',[phone+'@c.us',h]),true)}
  await link(buyer,'50370000001');await link(buyer2,'50370000002');
  let seq=0;
  async function listing(){const receipt=(await rpc('accept_message',[JSON.stringify({sessionId:'pilot',messageId:String(++seq),chatId:'50370000000@c.us',type:'image'})])).id;
   return (await db.query(`insert into public.listings(merchant_id,source_receipt_id,slug,label,image_path,price_cents,deposit_cents,pickup_point)
     values($1,$2,$3,'Artículo','photo.png',1250,250,'Puesto 1') returning *`,[merchant,receipt,crypto.randomUUID().replaceAll('-','')])).rows[0]}
  const l=await listing(),codeHash=await hash('ABCD2345');
  const args=[buyer,l.slug,'checkout-key-0001','deposit',codeHash,'encrypted-code'];
  const first=await rpc('reserve_order',args);assert.equal(first.status,'pending_payment');
  assert.equal((await rpc('reserve_order',args)).id,first.id);
  await assert.rejects(rpc('reserve_order',[buyer2,l.slug,'checkout-key-0002','deposit',await hash('EFGH2345'),'encrypted']),/Listing unavailable/);
  assert.equal(await rpc('claim_checkout',[first.id]),true);assert.equal(await rpc('claim_checkout',[first.id]),false);
  await rpc('save_checkout',[first.id,'link1','https://lk.wompi.sv/test']);
  assert.equal((await rpc('apply_payment',[first.id,'payment1','link1',250,'USD','approved'])).status,'reserved');
  assert.equal((await rpc('apply_payment',[first.id,'payment1','link1',250,'USD','approved'])).duplicate,true);
  assert.equal((await db.query("select count(*)::int n from public.domain_events where kind='payment_confirmed'")).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from public.notification_outbox')).rows[0].n,3);
  assert.equal((await rpc('deliver_order',[merchant,codeHash])).kind,'delivered');
  assert.equal((await rpc('deliver_order',[merchant,codeHash])).kind,'already_delivered');
  assert.equal((await db.query('select score from public.buyers where id=$1',[buyer])).rows[0].score,55);
  await rpc('recalculate_score',[buyer]);assert.equal((await db.query('select score from public.buyers where id=$1',[buyer])).rows[0].score,55);
  assert.deepEqual(await rpc('record_fee',[first.id,25,'statement-1']),{fee:25,subsidy:25});
  await rpc('record_fee',[first.id,25,'statement-1']);
  assert.equal((await db.query("select count(*)::int n from public.settlement_entries where kind='fee_subsidy'")).rows[0].n,1);
  const l2=await listing(),second=await rpc('reserve_order',[buyer,l2.slug,'checkout-key-0003','deposit',await hash('IJKL2345'),'encrypted']);
  await rpc('claim_checkout',[second.id]);await rpc('save_checkout',[second.id,'link2','https://lk.wompi.sv/test2']);
  await rpc('apply_payment',[second.id,'payment2','link2',250,'USD','approved']);
  await db.query("update public.orders set reserved_at=now()-interval '2 days',pickup_expires_at=now()-interval '1 day' where id=$1",[second.id]);
  assert.equal(await rpc('expire_reserved_orders'),1);assert.equal(await rpc('expire_reserved_orders'),0);
  assert.equal((await db.query('select score from public.buyers where id=$1',[buyer])).rows[0].score,40);
  assert.equal((await db.query('select status from public.listings where id=$1',[l2.id])).rows[0].status,'available');
  const third=await rpc('reserve_order',[buyer2,l2.slug,'checkout-key-0004','deposit',await hash('MNOP2345'),'encrypted']);
  assert.equal((await rpc('apply_payment',[second.id,'late-extra-payment','link2',250,'USD','approved'])).status,'payment_review');
  assert.equal((await db.query('select status from public.orders where id=$1',[third.id])).rows[0].status,'pending_payment');
  assert.equal((await db.query('select status from public.listings where id=$1',[l2.id])).rows[0].status,'reserved');
  assert.equal((await rpc('deliver_order',[crypto.randomUUID(),codeHash])).kind,'invalid_code');
  const l3=await listing();await assert.rejects(rpc('reserve_order',[buyer,l3.slug,'checkout-key-0005','cod',await hash('QRST2345'),'encrypted']),/Cash on delivery unavailable/);
  await db.exec('update public.pilot_settings set cod_enabled=true');await db.query('update public.buyers set score=80,delivered_count=6 where id=$1',[buyer]);
  const cod=await rpc('reserve_order',[buyer,l3.slug,'checkout-key-0005','cod',await hash('QRST2345'),'encrypted']);assert.equal(cod.status,'reserved');assert.equal(cod.deposit_cents,0);
  const report=await rpc('operations_report');assert.equal(report.metrics.paid,2);assert.equal(report.metrics.noShows,1);
 }finally{await db.close()}
});

test('buyer linking cannot claim another phone, and notification leases do not repeat uncertain sends',async()=>{
 const {db,rpc}=await setup();
 try{
  const b=await rpc('buyer_identity',[crypto.randomUUID(),'+50370000001']);const h=await hash('link-token');await rpc('create_chat_link',[b.id,h]);
  assert.equal(await rpc('consume_chat_link',['50370000002@c.us',h]),false);
  assert.equal(await rpc('consume_chat_link',['999999999@lid',h]),false);
  assert.equal(await rpc('consume_chat_link',['50370000001@c.us',h]),true);
  assert.equal(await rpc('consume_chat_link',['50370000001@c.us',h]),false);
  const m=(await db.query("insert into public.merchants(chat_id,enabled) values('50370000000@c.us',true) returning id")).rows[0].id;
  const eid=await rpc('domain_event',['event-1','daily_summary',m,null,'{}']);
  await rpc('queue_notice',[eid,'notice-1','50370000000@c.us','daily_summary',new Date().toISOString(),JSON.stringify({merchantId:m,day:'2026-09-04'})]);
  const rows=(await db.query('select * from public.claim_notices()')).rows;assert.equal(rows.length,1);
  assert.equal((await db.query('select * from public.claim_notices()')).rows.length,0);
  await rpc('finish_notice',[rows[0].id,rows[0].lease_token,'sending']);
  await db.exec("update public.notification_outbox set leased_until=now()-interval '1 minute'");
  assert.equal((await db.query('select * from public.claim_notices()')).rows.length,0);
  assert.equal((await db.query('select status from public.notification_outbox')).rows[0].status,'needs_review');
  const privateFunctions=['process_bot(uuid,uuid,text,integer,text)','reserve_order(uuid,text,text,text,text,text)','operations_report()'];
  for(const f of privateFunctions)assert.equal((await db.query("select has_function_privilege('anon',$1,'EXECUTE') allowed",['public.'+f])).rows[0].allowed,false);
 }finally{await db.close()}
});

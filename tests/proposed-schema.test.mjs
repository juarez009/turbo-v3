import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('proposed snapshot prevents duplicate active reservations and inconsistent ownership', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    await db.exec(await readFile(new URL('../docs/kit-propuesto/03-supabase-schema.sql', import.meta.url), 'utf8'));
    const merchant = (await db.query("insert into public.merchants(chat_id) values ('50370000000@c.us') returning id")).rows[0].id;
    const otherMerchant = (await db.query("insert into public.merchants(chat_id) values ('50370000001@c.us') returning id")).rows[0].id;
    const buyer = (await db.query('insert into public.buyers default values returning id')).rows[0].id;
    const receipt = (await db.query(`insert into public.message_receipts(session_id,message_id,merchant_id,message)
      values('pilot','one',$1,'{}') returning id`, [merchant])).rows[0].id;
    const listing = (await db.query(`insert into public.listings(merchant_id,source_receipt_id,slug,label,image_path,price_cents,deposit_cents,pickup_point)
      values($1,$2,'abcdefgh12345678','Artículo','private/photo.png',1250,250,'Puesto 1') returning id`, [merchant,receipt])).rows[0].id;
    const createOrder = async (owner, key) => db.query(`insert into public.orders(listing_id,merchant_id,buyer_id,idempotency_key,payment_method,
      price_cents,deposit_cents,pickup_point,terms_version,checkout_expires_at)
      values($1,$2,$3,$4,'deposit',1250,250,'Puesto 1','draft-v1',now()+interval '15 minutes') returning id`, [listing,owner,buyer,key]);
    const order = (await createOrder(merchant,'idempotency-key-001')).rows[0].id;
    await assert.rejects(createOrder(merchant,'idempotency-key-002'), /one_active_order_per_listing/);
    await assert.rejects(db.query("update public.orders set merchant_id=$1 where id=$2",[otherMerchant,order]), /foreign key/);
    await assert.rejects(db.query("update public.orders set status='reserved' where id=$1",[order]), /check constraint/);
    await db.query("update public.orders set status='expired',expiry_reason='checkout_timeout' where id=$1",[order]);
    assert.ok((await createOrder(merchant,'idempotency-key-002')).rows[0].id);
    await db.query("insert into public.payment_transactions(order_id,provider,provider_ref,amount_cents,currency,status,verified_at) values($1,'wompi_sv','ref-1',250,'USD','approved',now())",[order]);
    await assert.rejects(db.query("insert into public.payment_transactions(order_id,provider,provider_ref,amount_cents,currency,status,verified_at) values($1,'wompi_sv','ref-1',250,'USD','approved',now())",[order]), /unique constraint/);
    const privateTables = ['buyers','bot_sessions','listings','orders','payment_transactions','domain_events','notification_outbox','settlement_entries'];
    for (const name of privateTables) {
      assert.equal((await db.query("select has_table_privilege('anon',$1,'SELECT') as allowed",[`public.${name}`])).rows[0].allowed,false);
      assert.equal((await db.query('select relrowsecurity from pg_class where relname=$1',[name])).rows[0].relrowsecurity,true);
    }
  } finally { await db.close(); }
});

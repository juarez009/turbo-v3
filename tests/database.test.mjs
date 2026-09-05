import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration, transactional deduplication, leases, privileges and private bucket', async () => {
  const db = new PGlite();
  try {
    // Supabase-owned objects are stubbed; application SQL runs unmodified in Postgres WASM.
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
    await db.exec(await readFile(new URL('../supabase/migrations/0001_init.sql', import.meta.url), 'utf8'));
    const message = { sessionId: 'pilot', messageId: 'one', chatId: '50370000000@c.us', type: 'text', text: 'hola' };
    const accept = async value => (await db.query('select public.accept_message($1::jsonb) as result', [JSON.stringify(value)])).rows[0].result;
    const first = await accept(message); const duplicate = await accept(message);
    assert.equal(first.id, duplicate.id);
    assert.equal((await db.query('select * from public.events')).rows.length, 1);
    assert.equal((await db.query('select * from public.merchants')).rows.length, 1);
    const claim = async id => (await db.query('select public.claim_message($1) as result', [id])).rows[0].result;
    const job = await claim(first.id); assert.ok(job.token);
    assert.equal(await claim(first.id), null);
    await assert.rejects(db.query('select public.mark_message_sending($1,$2)', [first.id, crypto.randomUUID()]), /Lease lost/);
    await db.query('select public.mark_message_sending($1,$2)', [first.id, job.token]);
    await db.query("update public.message_receipts set leased_until = now() - interval '1 second' where id = $1", [first.id]);
    assert.equal(await claim(first.id), null);
    assert.equal((await db.query('select status from public.message_receipts where id = $1', [first.id])).rows[0].status, 'needs_review');
    const second = await accept({ ...message, messageId: 'two' });
    const lease = await claim(second.id);
    await db.query("select public.finish_message($1,$2,'retry',null)", [second.id, lease.token]);
    const retry = await claim(second.id); assert.notEqual(retry.token, lease.token);
    await db.query("select public.finish_message($1,$2,'held',null)", [second.id, retry.token]);
    assert.equal(await claim(second.id), null);
    const privileges = await db.query(`select
      has_function_privilege('anon','public.accept_message(jsonb)','EXECUTE') as anon,
      has_function_privilege('authenticated','public.pending_messages()','EXECUTE') as authenticated,
      has_function_privilege('service_role','public.accept_message(jsonb)','EXECUTE') as service`);
    assert.deepEqual(privileges.rows[0], { anon: false, authenticated: false, service: true });
    assert.ok((await db.query("select relrowsecurity from pg_class where relname in ('merchants','message_receipts','events')")).rows.every(row => row.relrowsecurity));
    assert.equal((await db.query('select public from storage.buckets')).rows[0].public, false);
  } finally { await db.close(); }
});

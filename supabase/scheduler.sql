-- Apply separately on Supabase after migrations and Edge deployment.
-- Requires Vault secrets apartaya_worker_url (full HTTPS URL) and
-- apartaya_worker_secret (same value as WORKER_SECRET), created in the dashboard.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create or replace function public.dispatch_apartaya_worker() returns bigint
language plpgsql security definer set search_path='' as $$
declare endpoint text; secret text; request_id bigint;
begin
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='apartaya_worker_url';
 select decrypted_secret into secret from vault.decrypted_secrets where name='apartaya_worker_secret';
 if endpoint is null or secret is null or endpoint not like 'https://%/functions/v1/worker' then raise exception 'Worker Vault configuration missing'; end if;
 select net.http_post(url:=endpoint,headers:=jsonb_build_object('Authorization','Bearer '||secret,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function public.dispatch_apartaya_worker() from public,anon,authenticated;
-- Independent expiry keeps inventory correct even while the channel is unavailable.
select cron.schedule('apartaya-expire','* * * * *','select public.expire_reserved_orders()');
select cron.schedule('apartaya-notices','* * * * *','select public.dispatch_apartaya_worker()');

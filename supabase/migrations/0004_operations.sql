alter table public.merchants add column onboarding_started_at timestamptz;
create table public.chat_links (
  buyer_id uuid primary key references public.buyers(id),
  token_hash text not null unique,
  expires_at timestamptz not null
);
alter table public.chat_links enable row level security;
revoke all on public.chat_links from public,anon,authenticated;

create function public.create_chat_link(p_buyer uuid,p_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(42801);
 if not public.take_rate('link:'||p_buyer,5,600) then raise exception 'Rate limited'; end if;
 insert into public.chat_links values(p_buyer,p_hash,now()+interval '10 minutes')
 on conflict(buyer_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at;
end $$;

create function public.consume_chat_link(p_chat text,p_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.buyers;
begin
 perform pg_advisory_xact_lock(42801);
 if not public.take_rate('link-attempt:'||p_chat,10,600) then return false; end if;
 select buyers.* into b from public.buyers join public.chat_links on chat_links.buyer_id=buyers.id
 where token_hash=p_hash and expires_at>now() and phone_verified_at is not null;
 if b.id is null or p_chat !~ '^503[0-9]{8}@(c\.us|s\.whatsapp\.net)$' or '+'||split_part(p_chat,'@',1)<>b.phone_e164 then return false; end if;
 update public.buyers set chat_id=p_chat,chat_verified_at=now() where id=b.id;
 delete from public.chat_links where buyer_id=b.id;
 return true;
end $$;

create function public.enable_merchant(p_id uuid,p_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(42801);
 update public.merchants set enabled=true,display_name=p_name,onboarding_started_at=coalesce(onboarding_started_at,now()) where id=p_id;
 if not found then raise exception 'Unknown merchant'; end if;
 perform public.domain_event('enabled:'||p_id,'merchant_enabled',p_id,null);
 return jsonb_build_object('enabled',true);
end $$;

create function public.record_fee(p_order uuid,p_fee integer,p_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; place bigint; existing integer;
begin
 perform pg_advisory_xact_lock(42801);
 select * into o from public.orders where id=p_order;
 if not exists(select 1 from public.settlement_entries where order_id=p_order and kind='deposit' and status='confirmed') then raise exception 'No confirmed deposit'; end if;
 if p_fee<0 or p_fee>o.deposit_cents or length(p_reference)<1 then raise exception 'Invalid fee'; end if;
 select amount_cents into existing from public.settlement_entries where entry_key='fee:'||p_order;
 if existing is not null and existing<>p_fee then raise exception 'Fee conflict'; end if;
 select position into place from (
   select order_id,row_number() over(order by created_at,id) as position from public.settlement_entries
   where merchant_id=o.merchant_id and kind='deposit' and status='confirmed') ranked where order_id=p_order;
 if p_fee>0 then
   insert into public.settlement_entries(merchant_id,order_id,entry_key,kind,amount_cents,status,external_reference)
   values(o.merchant_id,p_order,'fee:'||p_order,'provider_fee',p_fee,'confirmed',p_reference) on conflict do nothing;
   if place<=5 then
     insert into public.settlement_entries(merchant_id,order_id,entry_key,kind,amount_cents,status,external_reference)
     values(o.merchant_id,p_order,'subsidy:'||p_order,'fee_subsidy',p_fee,'confirmed',p_reference) on conflict do nothing;
   end if;
 end if;
 return jsonb_build_object('fee',p_fee,'subsidy',case when place<=5 then p_fee else 0 end);
end $$;

create function public.operations_report() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object(
  'merchants',(select coalesce(jsonb_agg(t),'[]') from (select m.id,m.display_name,m.enabled,m.chat_id,public.sales_summary(m.id) as sales from public.merchants m order by created_at desc limit 100) t),
  'orders',(select coalesce(jsonb_agg(t),'[]') from (select id,merchant_id,status,deposit_cents,checkout_state,created_at from public.orders order by created_at desc limit 100) t),
  'settlement',(select coalesce(jsonb_agg(t),'[]') from (select merchant_id,kind,status,sum(amount_cents) amount_cents from public.settlement_entries group by merchant_id,kind,status) t),
  'metrics',jsonb_build_object(
    'activeMerchants',(select count(distinct merchant_id) from public.listings where created_at>=now()-interval '7 days' and merchant_id in(select id from public.merchants where enabled)),
    'listings',(select count(*) from public.listings),
    'checkouts',(select count(*) from public.domain_events where kind='checkout_started'),
    'paid',(select count(*) from public.domain_events where kind='payment_confirmed'),
    'delivered',(select count(*) from public.orders where status='delivered'),
    'noShows',(select count(*) from public.orders where expiry_reason='no_show'),
    'terminalReservations',(select count(*) from public.orders where reserved_at is not null and status in('delivered','expired','cancelled')),
    'reviews',(select count(*) from public.payment_transactions where status='review'),
    'notificationReview',(select count(*) from public.notification_outbox where status='needs_review'),
    'messageReview',(select count(*) from public.message_receipts where status='needs_review'),
    'firstLinkMedianSeconds',(select percentile_cont(0.5) within group(order by duration) from
      (select extract(epoch from(min(l.created_at)-m.onboarding_started_at)) duration from public.merchants m join public.listings l on l.merchant_id=m.id where m.onboarding_started_at is not null group by m.id) t)
  ));
$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('create_chat_link','consume_chat_link','enable_merchant','record_fee','operations_report') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

grant select,insert,update,delete on public.merchants,public.message_receipts,public.events,public.buyers,public.bot_sessions,
  public.listings,public.orders,public.payment_transactions,public.domain_events,public.notification_outbox,public.settlement_entries,
  public.pilot_settings,public.rate_windows,public.chat_links to service_role;
grant usage,select on sequence public.events_id_seq to service_role;

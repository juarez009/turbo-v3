-- Application workflows. A single short transaction lock serializes pilot domain
-- mutations; no network calls occur while holding it. Scale by listing later.
alter table public.orders add column pickup_code_ciphertext text;
alter table public.orders add column checkout_url text;
alter table public.orders add column checkout_provider_id text unique;
alter table public.orders add column checkout_state text not null default 'new'
  check(checkout_state in ('new','creating','ready','review'));
alter table public.message_receipts add column bot_result jsonb;
alter table public.notification_outbox add column payload jsonb not null default '{}';
create table public.pilot_settings (
  id boolean primary key default true check(id),
  cod_enabled boolean not null default false,
  checkout_minutes integer not null default 15 check(checkout_minutes between 1 and 60),
  reservation_hours integer not null default 24 check(reservation_hours between 3 and 72),
  terms_version text not null default 'pilot-v1'
);
insert into public.pilot_settings default values;
create table public.rate_windows (
  key text primary key, hits integer not null, resets_at timestamptz not null
);
alter table public.pilot_settings enable row level security;
alter table public.rate_windows enable row level security;
revoke all on public.pilot_settings,public.rate_windows from public,anon,authenticated;

create function public.take_rate(p_key text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  insert into public.rate_windows values(p_key,1,now()+make_interval(secs=>p_seconds))
  on conflict(key) do update set hits=case when rate_windows.resets_at<=now() then 1 else rate_windows.hits+1 end,
    resets_at=case when rate_windows.resets_at<=now() then now()+make_interval(secs=>p_seconds) else rate_windows.resets_at end
  returning hits into n;
  return n<=p_limit;
end $$;

create function public.domain_event(p_key text,p_kind text,p_merchant uuid,p_order uuid,p_metadata jsonb default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare eid uuid;
begin
  insert into public.domain_events(event_key,kind,merchant_id,order_id,metadata)
  values(p_key,p_kind,p_merchant,p_order,p_metadata) on conflict(event_key) do nothing returning id into eid;
  if eid is null then select id into eid from public.domain_events where event_key=p_key; end if;
  return eid;
end $$;

create function public.queue_notice(p_event uuid,p_key text,p_chat text,p_template text,p_due timestamptz,p_payload jsonb) returns void
language sql security definer set search_path='' as $$
  insert into public.notification_outbox(event_id,dedup_key,recipient_chat_id,template,template_version,due_at,payload)
  select p_event,p_key,p_chat,p_template,'v1',p_due,p_payload where p_chat is not null
  on conflict(dedup_key) do nothing;
$$;

create function public.recalculate_score(p_buyer uuid) returns void
language sql security definer set search_path='' as $$
  update public.buyers set delivered_count=t.delivered,
    score=greatest(0,least(100,50+5*t.delivered-15*t.missed))
  from (select count(*) filter(where status='delivered')::int delivered,
    count(*) filter(where status='expired' and expiry_reason='no_show')::int missed
    from public.orders where buyer_id=p_buyer) t where id=p_buyer;
$$;

create function public.sales_summary(p_merchant uuid,p_day date default (now() at time zone 'America/El_Salvador')::date) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('date',p_day,
  'reserved',(select count(*) from public.orders where merchant_id=p_merchant and (reserved_at at time zone 'America/El_Salvador')::date=p_day),
  'delivered',(select count(*) from public.orders where merchant_id=p_merchant and (delivered_at at time zone 'America/El_Salvador')::date=p_day),
  'expired',(select count(*) from public.domain_events where merchant_id=p_merchant and kind='order_expired' and (created_at at time zone 'America/El_Salvador')::date=p_day),
  'deposits',(select coalesce(sum(amount_cents),0) from public.settlement_entries where merchant_id=p_merchant and kind='deposit' and status='confirmed' and (created_at at time zone 'America/El_Salvador')::date=p_day),
  'review',(select count(*) from public.orders where merchant_id=p_merchant and status='payment_review'));
$$;

create function public.deliver_order(p_merchant uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; eid uuid;
begin
  perform pg_advisory_xact_lock(42801);
  if not public.take_rate('delivery:'||p_merchant,10,600) then return jsonb_build_object('kind','rate_limited'); end if;
  select * into o from public.orders where merchant_id=p_merchant and pickup_code_hash=p_hash;
  if o.id is null then return jsonb_build_object('kind','invalid_code'); end if;
  if o.status='delivered' then return jsonb_build_object('kind','already_delivered'); end if;
  if o.status<>'reserved' or o.pickup_expires_at<=now() then return jsonb_build_object('kind','expired_code'); end if;
  update public.orders set status='delivered',delivered_at=now() where id=o.id;
  update public.listings set status='sold' where id=o.listing_id;
  update public.notification_outbox set status='cancelled' where payload->>'orderId'=o.id::text and template='reminder' and status in ('pending','processing');
  eid:=public.domain_event('delivered:'||o.id,'order_delivered',o.merchant_id,o.id);
  perform public.recalculate_score(o.buyer_id);
  return jsonb_build_object('kind','delivered');
end $$;

create function public.process_bot(p_receipt uuid,p_token uuid,p_image_path text,p_price integer,p_code_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.message_receipts; m public.merchants; s public.bot_sessions;
  result jsonb; command text; l public.listings; eid uuid; price integer;
begin
  perform pg_advisory_xact_lock(42801);
  select * into r from public.message_receipts where id=p_receipt;
  if r.bot_result is not null then return r.bot_result; end if;
  if r.token is distinct from p_token or r.status<>'processing' or r.leased_until<=now() then raise exception 'Lease lost'; end if;
  -- Arrival ordering per merchant; let the worker retry after the preceding message.
  if exists(select 1 from public.message_receipts where merchant_id=r.merchant_id and id<>r.id
    and (created_at,id)<(r.created_at,r.id) and bot_result is null and status in ('pending','processing','retry')) then
    raise exception 'Earlier message pending';
  end if;
  select * into m from public.merchants where id=r.merchant_id;
  insert into public.bot_sessions(merchant_id) values(m.id) on conflict do nothing;
  select * into s from public.bot_sessions where merchant_id=m.id;
  command:=upper(trim(coalesce(r.message->>'text','')));
  if command like 'VINCULAR %' then
    result:=jsonb_build_object('kind',case when public.consume_chat_link(r.message->>'chatId',p_code_hash) then 'linked' else 'invalid_link' end);
  elsif not m.enabled then result:=jsonb_build_object('kind','onboarding');
  elsif not public.take_rate('bot:'||m.id,30,60) then result:=jsonb_build_object('kind','rate_limited');
  elsif command='AYUDA' then result:=jsonb_build_object('kind','help');
  elsif command='VENTAS' then result:=jsonb_build_object('kind','sales','summary',public.sales_summary(m.id));
  elsif command='PUNTO' then
    update public.bot_sessions set intent='pickup_point' where merchant_id=m.id;
    result:=jsonb_build_object('kind','ask_point');
  elsif command='CANCELAR' then
    if s.intent is not null then
      update public.bot_sessions set intent=null where merchant_id=m.id;
      result:=jsonb_build_object('kind','point_cancelled');
    else
      update public.bot_sessions set state='IDLE',draft_image_path=null,draft_price_cents=null where merchant_id=m.id;
      result:=jsonb_build_object('kind',case when s.state='IDLE' then 'no_draft' else 'cancelled' end);
    end if;
  elsif command='ENTREGADO' or command like 'ENTREGADO %' then
    if p_code_hash is null then result:=jsonb_build_object('kind','ask_code');
    else result:=public.deliver_order(m.id,p_code_hash); end if;
  elsif s.intent='pickup_point' then
    if r.message->>'type'<>'text' or length(trim(r.message->>'text')) not between 3 and 500 then result:=jsonb_build_object('kind','ask_point');
    else
      update public.merchants set pickup_point=trim(r.message->>'text') where id=m.id returning * into m;
      update public.bot_sessions set intent=null where merchant_id=m.id;
      result:=jsonb_build_object('kind','point_saved','point',m.pickup_point);
      -- A saved price can be completed without forcing the merchant to resend it.
      price:=s.draft_price_cents;
    end if;
  elsif r.message->>'type'='image' then
    if p_image_path is null then result:=jsonb_build_object('kind','image_missing');
    elsif split_part(p_image_path,'/',1)<>m.id::text then raise exception 'Invalid media owner';
    else
      update public.bot_sessions set state='AWAITING_PRICE',draft_image_path=p_image_path,draft_price_cents=null where merchant_id=m.id;
      result:=jsonb_build_object('kind',case when s.state='AWAITING_PRICE' then 'photo_replaced' else 'ask_price' end);
    end if;
  elsif s.state='AWAITING_PRICE' then
    if p_price is null then result:=jsonb_build_object('kind','invalid_price');
    elsif p_price not between 100 and 100000 then result:=jsonb_build_object('kind','price_range');
    else price:=p_price; end if;
  else result:=jsonb_build_object('kind','idle'); end if;
  if price is not null then
    if m.pickup_point is null then
      update public.bot_sessions set draft_price_cents=price where merchant_id=m.id;
      result:=jsonb_build_object('kind','missing_point');
    else
      insert into public.listings(merchant_id,source_receipt_id,slug,label,image_path,price_cents,deposit_cents,pickup_point)
      values(m.id,r.id,replace(gen_random_uuid()::text,'-',''),'Artículo de '||coalesce(m.display_name,'tu comerciante'),s.draft_image_path,
        price,least(price,greatest(100,(price+4)/5)),m.pickup_point) returning * into l;
      update public.bot_sessions set state='IDLE',draft_image_path=null,draft_price_cents=null where merchant_id=m.id;
      eid:=public.domain_event('listing:'||r.id,'listing_created',m.id,null,jsonb_build_object('listingId',l.id));
      result:=jsonb_build_object('kind','published','slug',l.slug,'price',l.price_cents,'deposit',l.deposit_cents,'point',l.pickup_point);
    end if;
  end if;
  update public.bot_sessions set version=version+1,updated_at=now() where merchant_id=m.id;
  update public.message_receipts set bot_result=result where id=r.id;
  return result;
end $$;

create function public.buyer_identity(p_auth uuid,p_phone text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.buyers;
begin
  perform pg_advisory_xact_lock(42801);
  if p_phone !~ '^\+503[0-9]{8}$' then raise exception 'Verified Salvadoran phone required'; end if;
  select * into b from public.buyers where auth_user_id=p_auth;
  if b.id is null then
    insert into public.buyers(auth_user_id,phone_e164,phone_verified_at) values(p_auth,p_phone,now()) returning * into b;
  elsif b.phone_e164<>p_phone then raise exception 'Identity change requires review'; end if;
  return to_jsonb(b);
end $$;

create function public.reserve_order(p_buyer uuid,p_slug text,p_key text,p_method text,p_code_hash text,p_code_ciphertext text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.buyers; l public.listings; o public.orders; cfg public.pilot_settings; eid uuid;
begin
  perform pg_advisory_xact_lock(42801);
  select * into o from public.orders where buyer_id=p_buyer and idempotency_key=p_key;
  if o.id is not null then
    if o.payment_method<>p_method or not exists(select 1 from public.listings where id=o.listing_id and slug=p_slug) then raise exception 'Idempotency conflict'; end if;
    return to_jsonb(o);
  end if;
  if not public.take_rate('orders:'||p_buyer,10,600) then raise exception 'Rate limited'; end if;
  select * into cfg from public.pilot_settings;
  select * into b from public.buyers where id=p_buyer;
  if b.phone_verified_at is null or b.chat_verified_at is null then raise exception 'Verified identity required'; end if;
  select * into l from public.listings where slug=p_slug;
  if l.id is null or l.status<>'available' or not exists(select 1 from public.merchants where id=l.merchant_id and enabled) then raise exception 'Listing unavailable'; end if;
  if p_method='cod' and not (cfg.cod_enabled and b.score>=80 and b.delivered_count>=3) then raise exception 'Cash on delivery unavailable'; end if;
  insert into public.orders(listing_id,merchant_id,buyer_id,idempotency_key,payment_method,price_cents,deposit_cents,currency,pickup_point,
    terms_version,pickup_code_hash,pickup_code_ciphertext,checkout_expires_at,status,reserved_at,pickup_expires_at)
  values(l.id,l.merchant_id,b.id,p_key,p_method,l.price_cents,case when p_method='cod' then 0 else l.deposit_cents end,l.currency,l.pickup_point,
    cfg.terms_version,p_code_hash,p_code_ciphertext,now()+make_interval(mins=>cfg.checkout_minutes),
    case when p_method='cod' then 'reserved' else 'pending_payment' end,
    case when p_method='cod' then now() end,case when p_method='cod' then now()+make_interval(hours=>cfg.reservation_hours) end) returning * into o;
  update public.listings set status='reserved' where id=l.id;
  eid:=public.domain_event('checkout:'||o.id,'checkout_started',o.merchant_id,o.id);
  if p_method='cod' then perform public.reservation_notices(o.id); end if;
  return to_jsonb(o);
end $$;

create function public.reservation_notices(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.orders; b public.buyers; m public.merchants; eid uuid;
begin
  select * into o from public.orders where id=p_order;
  select * into b from public.buyers where id=o.buyer_id;
  select * into m from public.merchants where id=o.merchant_id;
  eid:=public.domain_event('reserved:'||o.id,'order_reserved',o.merchant_id,o.id);
  perform public.queue_notice(eid,'reserved-merchant:'||o.id,m.chat_id,'reserved_merchant',now(),jsonb_build_object('orderId',o.id));
  if b.chat_verified_at is not null then
    perform public.queue_notice(eid,'reserved-buyer:'||o.id,b.chat_id,'reserved_buyer',now(),jsonb_build_object('orderId',o.id));
    perform public.queue_notice(eid,'reminder:'||o.id,b.chat_id,'reminder',o.pickup_expires_at-interval '2 hours',jsonb_build_object('orderId',o.id));
  end if;
end $$;

create function public.claim_checkout(p_order uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(42801);
 update public.orders set checkout_state='creating' where id=p_order and checkout_state='new' and status='pending_payment' and checkout_expires_at>now();
 return found;
end $$;

create function public.save_checkout(p_order uuid,p_provider_id text,p_url text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(42801);
 update public.orders set checkout_provider_id=p_provider_id,checkout_url=p_url,checkout_state='ready'
 where id=p_order and checkout_state='creating';
 if not found then raise exception 'Checkout not claimed'; end if;
end $$;

create function public.apply_payment(p_order uuid,p_ref text,p_link text,p_amount integer,p_currency text,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; t public.payment_transactions; cfg public.pilot_settings; eid uuid; review boolean;
begin
 perform pg_advisory_xact_lock(42801);
 select * into o from public.orders where id=p_order;
 if o.id is null then raise exception 'Unknown order'; end if;
 select * into t from public.payment_transactions where provider='wompi_sv' and provider_ref=p_ref;
 if t.id is not null then
   if t.order_id<>p_order or t.amount_cents<>p_amount or t.currency<>p_currency then raise exception 'Payment identity conflict'; end if;
   if t.status in ('approved','refunded','review') or t.status=p_status then return jsonb_build_object('status',o.status,'duplicate',true); end if;
 end if;
 if p_status not in ('approved','failed','pending') then raise exception 'Invalid payment state'; end if;
 if o.checkout_provider_id is null then raise exception 'Checkout correlation not ready'; end if;
 if p_currency<>'USD' then raise exception 'Unexpected currency'; end if;
 review:=o.payment_method<>'deposit' or o.checkout_provider_id<>p_link or o.deposit_cents<>p_amount;
 if p_status='approved' and (o.status<>'pending_payment' or o.checkout_expires_at<=now()) then review:=true; end if;
 insert into public.payment_transactions(order_id,provider,provider_ref,amount_cents,currency,status,verified_at)
 values(o.id,'wompi_sv',p_ref,p_amount,p_currency,case when review then 'review' else p_status end,now())
 on conflict(provider,provider_ref) do update set status=excluded.status,verified_at=now();
 if review then
   -- Do not overwrite an already delivered/reserved order on an extra unexpected payment.
   if o.status='pending_payment' then
     update public.orders set status='payment_review' where id=o.id;
     update public.listings set status='available' where id=o.listing_id and status='reserved'
       and not exists(select 1 from public.orders where listing_id=o.listing_id and id<>o.id and status in ('pending_payment','reserved'));
   end if;
   eid:=public.domain_event('payment-review:'||p_ref,'payment_review',o.merchant_id,o.id);
   return jsonb_build_object('status','payment_review');
 elsif p_status='approved' then
   select * into cfg from public.pilot_settings;
   update public.orders set status='reserved',reserved_at=now(),pickup_expires_at=now()+make_interval(hours=>cfg.reservation_hours) where id=o.id;
   insert into public.settlement_entries(merchant_id,order_id,entry_key,kind,amount_cents,status,external_reference)
   values(o.merchant_id,o.id,'deposit:'||p_ref,'deposit',p_amount,'confirmed',p_ref) on conflict do nothing;
   eid:=public.domain_event('paid:'||p_ref,'payment_confirmed',o.merchant_id,o.id,jsonb_build_object('amountCents',p_amount));
   perform public.reservation_notices(o.id);
 elsif p_status='failed' and o.status='pending_payment' then
   update public.orders set status='payment_failed' where id=o.id;
   update public.listings set status='available' where id=o.listing_id and status='reserved';
   eid:=public.domain_event('failed:'||p_ref,'payment_failed',o.merchant_id,o.id);
 end if;
 return jsonb_build_object('status',(select status from public.orders where id=o.id));
end $$;

create function public.expire_reserved_orders() returns integer
language plpgsql security definer set search_path='' as $$
declare o public.orders; b public.buyers; m public.merchants; eid uuid; n integer:=0;
begin
 perform pg_advisory_xact_lock(42801);
 for o in select * from public.orders where (status='pending_payment' and checkout_expires_at<=now()) or
   (status='reserved' and pickup_expires_at<=now()) order by created_at limit 100 for update skip locked loop
   update public.orders set status='expired',expiry_reason=case when o.status='reserved' then 'no_show' else 'checkout_timeout' end where id=o.id;
   update public.listings set status='available' where id=o.listing_id and status='reserved';
   update public.notification_outbox set status='cancelled' where payload->>'orderId'=o.id::text and template in ('reminder','reserved_buyer','reserved_merchant') and status in ('pending','processing');
   eid:=public.domain_event('expired:'||o.id,'order_expired',o.merchant_id,o.id,jsonb_build_object('noShow',o.status='reserved'));
   if o.status='reserved' then
     select * into m from public.merchants where id=o.merchant_id;
     select * into b from public.buyers where id=o.buyer_id;
     perform public.queue_notice(eid,'expired-merchant:'||o.id,m.chat_id,'expired_merchant',now(),jsonb_build_object('orderId',o.id));
     if b.chat_verified_at is not null then perform public.queue_notice(eid,'expired-buyer:'||o.id,b.chat_id,'expired_buyer',now(),jsonb_build_object('orderId',o.id)); end if;
     perform public.recalculate_score(o.buyer_id);
   end if;
   n:=n+1;
 end loop;
 delete from public.rate_windows where resets_at<now()-interval '1 day';
 return n;
end $$;

create function public.daily_summaries() returns integer
language plpgsql security definer set search_path='' as $$
declare m public.merchants; day date:=(now() at time zone 'America/El_Salvador')::date; eid uuid; n integer:=0;
begin
 perform pg_advisory_xact_lock(42801);
 if (now() at time zone 'America/El_Salvador')::time<time '19:30' then return 0; end if;
 for m in select * from public.merchants where enabled loop
   eid:=public.domain_event('summary:'||m.id||':'||day,'daily_summary',m.id,null);
   perform public.queue_notice(eid,'summary:'||m.id||':'||day,m.chat_id,'daily_summary',now(),jsonb_build_object('merchantId',m.id,'day',day));
   n:=n+1;
 end loop;
 return n;
end $$;

create function public.claim_notices() returns setof public.notification_outbox
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(42801);
 update public.notification_outbox set status='needs_review' where status='sending' and leased_until<now();
 update public.notification_outbox set status=case when attempts>=5 then 'needs_review' else 'pending' end
   where status='processing' and leased_until<now();
 return query update public.notification_outbox set status='processing',lease_token=gen_random_uuid(),leased_until=now()+interval '3 minutes',attempts=attempts+1
 where id in (select id from public.notification_outbox where status='pending' and due_at<=now() order by due_at limit 5)
 returning *;
end $$;

create function public.notice_context(p_id uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.notification_outbox; o public.orders; l public.listings;
begin
 perform pg_advisory_xact_lock(42801);
 select * into n from public.notification_outbox where id=p_id and lease_token=p_token and status='processing' and leased_until>now();
 if n.id is null then return null; end if;
 if n.template='daily_summary' then return jsonb_build_object('summary',public.sales_summary((n.payload->>'merchantId')::uuid,(n.payload->>'day')::date)); end if;
 select * into o from public.orders where id=(n.payload->>'orderId')::uuid;
 select * into l from public.listings where id=o.listing_id;
 if (n.template in ('reserved_buyer','reserved_merchant','reminder') and (o.status<>'reserved' or o.pickup_expires_at<=now())) then
   update public.notification_outbox set status='cancelled' where id=n.id; return null;
 end if;
 return jsonb_build_object('order',to_jsonb(o),'label',l.label,'available',l.status='available');
end $$;

create function public.finish_notice(p_id uuid,p_token uuid,p_status text) returns boolean
language plpgsql security definer set search_path='' as $$
declare n public.notification_outbox;
begin
 perform pg_advisory_xact_lock(42801);
 if p_status not in ('sending','sent','needs_review','pending') then raise exception 'Invalid notice status'; end if;
 if p_status='sending' then
   select * into n from public.notification_outbox where id=p_id and lease_token=p_token and status='processing' and leased_until>now();
   if n.id is null then raise exception 'Notice lease lost'; end if;
   if n.template in ('reserved_buyer','reserved_merchant','reminder') and not exists(
     select 1 from public.orders where id=(n.payload->>'orderId')::uuid and status='reserved' and pickup_expires_at>now()) then
     update public.notification_outbox set status='cancelled' where id=n.id;return false;
   end if;
 end if;
 update public.notification_outbox set status=case when p_status='pending' and attempts>=5 then 'needs_review' else p_status end,
 sent_at=case when p_status='sent' then now() else sent_at end
 where id=p_id and lease_token=p_token and leased_until>now() and status in ('processing','sending') returning * into n;
 if n.id is null then raise exception 'Notice lease lost'; end if;
 if p_status='sent' and n.template='reminder' then
   perform public.domain_event('reminder-sent:'||n.id,'reminder_sent',
     (select merchant_id from public.orders where id=(n.payload->>'orderId')::uuid),(n.payload->>'orderId')::uuid);
 end if;
 return true;
end $$;

-- No RPC in this migration is callable with an anon/user key.
do $$ declare f record;
begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('take_rate','domain_event','queue_notice','recalculate_score','sales_summary','deliver_order','process_bot',
   'buyer_identity','reserve_order','reservation_notices','claim_checkout','save_checkout','apply_payment','expire_reserved_orders','daily_summaries','claim_notices','notice_context','finish_notice') loop
   execute format('revoke all on function %s from public,anon,authenticated',f.signature);
   execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

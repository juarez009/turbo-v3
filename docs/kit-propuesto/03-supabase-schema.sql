-- GENERATED PROPOSAL v0.1. For an EMPTY isolated database, not production.
-- Combines existing Sprint 0 SQL with proposed domain tables.
-- See LEEME.md and 02-arquitectura-apartaya.md for unimplemented operations.

-- Provisional Sprint 0 schema. Reconcile with the missing 03-supabase-schema.sql
-- before any production migration. No orders/payment assumptions are encoded.
create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null unique,
  country_code text not null default 'SV',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table public.message_receipts (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  message_id text not null,
  merchant_id uuid not null references public.merchants(id),
  message jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','sending','retry','held','done','needs_review')),
  token uuid,
  leased_until timestamptz,
  attempts integer not null default 0,
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, message_id)
);
create index message_receipts_pending on public.message_receipts(status, updated_at);

create table public.events (
  id bigint generated always as identity primary key,
  merchant_id uuid not null references public.merchants(id),
  receipt_id uuid not null references public.message_receipts(id),
  kind text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (receipt_id, kind)
);
create index events_created on public.events(created_at);
alter table public.merchants enable row level security;
alter table public.message_receipts enable row level security;
alter table public.events enable row level security;
revoke all on public.merchants, public.message_receipts, public.events from anon, authenticated;

create function public.accept_message(p_message jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare merchant uuid; receipt uuid;
begin
  insert into public.merchants(chat_id) values (p_message->>'chatId')
  on conflict(chat_id) do update set last_seen_at = now() returning id into merchant;
  insert into public.message_receipts(session_id, message_id, merchant_id, message)
  values (p_message->>'sessionId', p_message->>'messageId', merchant, p_message)
  on conflict(session_id, message_id) do nothing returning id into receipt;
  if receipt is null then
    select id into receipt from public.message_receipts
      where session_id = p_message->>'sessionId' and message_id = p_message->>'messageId';
  else
    insert into public.events(merchant_id, receipt_id, kind, metadata)
    values (merchant, receipt, 'message_received', jsonb_build_object('type',p_message->>'type'));
  end if;
  return jsonb_build_object('id', receipt);
end $$;

create function public.claim_message(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.message_receipts;
begin
  -- A crashed sender may have delivered; never resend automatically.
  update public.message_receipts set status = 'needs_review', updated_at = now()
    where id = p_id and leased_until < now() and
      (status = 'sending' or (status = 'processing' and attempts >= 5));
  update public.message_receipts set status = 'processing', token = gen_random_uuid(),
    leased_until = now() + interval '60 seconds', attempts = attempts + 1, updated_at = now()
    where id = p_id and attempts < 5 and (status in ('pending','retry') or (status = 'processing' and leased_until < now()))
    returning * into item;
  if item.id is null then return null; end if;
  return jsonb_build_object('token',item.token,'message',item.message,'merchant_id',item.merchant_id);
end $$;

create function public.mark_message_sending(p_id uuid, p_token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.message_receipts set status = 'sending', updated_at = now()
    where id = p_id and token = p_token and status = 'processing' and leased_until > now();
  if not found then raise exception 'Lease lost'; end if;
  return true;
end $$;

create function public.finish_message(p_id uuid, p_token uuid, p_status text, p_image_path text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare merchant uuid;
begin
  if p_status not in ('done','held','retry','needs_review') then raise exception 'Invalid result'; end if;
  update public.message_receipts set status = case when p_status = 'retry' and attempts >= 5 then 'needs_review' else p_status end,
    image_path = coalesce(p_image_path,image_path), leased_until = null, updated_at = now(),
    message = case when p_status in ('done','held') then message - 'media' else message end
    where id = p_id and token = p_token and status in ('processing','sending')
    returning merchant_id into merchant;
  if merchant is null then raise exception 'Lease lost'; end if;
  insert into public.events(merchant_id,receipt_id,kind,metadata)
    values (merchant,p_id,'message_' || p_status,jsonb_build_object('image_path',p_image_path)) on conflict do nothing;
  return true;
end $$;

create function public.pending_messages() returns table(id uuid)
language sql security definer set search_path = '' as $$
  select r.id from public.message_receipts r where
    (r.status in ('pending','retry') and r.attempts < 5) or
    (r.status in ('processing','sending') and r.leased_until < now())
  order by r.updated_at limit 5;
$$;

revoke all on function public.accept_message(jsonb), public.claim_message(uuid),
  public.mark_message_sending(uuid,uuid), public.finish_message(uuid,uuid,text,text), public.pending_messages()
  from public, anon, authenticated;
grant execute on function public.accept_message(jsonb), public.claim_message(uuid),
  public.mark_message_sending(uuid,uuid), public.finish_message(uuid,uuid,text,text), public.pending_messages()
  to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('merchant-photos','merchant-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
-- No public Storage policies: only the server service role can access pilot photos.

-- Proposed domain extension, NOT an applied migration.
-- Requires Sprint 0 tables. See 03-supabase-schema.sql for the standalone snapshot.
-- Business RPCs, cron, public projections, identity verification and provider adapters
-- remain to be implemented; table constraints alone do not execute the business flow.

alter table public.merchants add column enabled boolean not null default false;
alter table public.merchants add column display_name text;
alter table public.merchants add column pickup_point text;

create table public.buyers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique, -- Link to Supabase Auth in the future application migration.
  phone_e164 text unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at timestamptz,
  chat_id text unique,
  chat_verified_at timestamptz,
  score smallint not null default 50 check(score between 0 and 100),
  delivered_count integer not null default 0 check(delivered_count >= 0),
  created_at timestamptz not null default now(),
  check(phone_verified_at is null or phone_e164 is not null),
  check(chat_verified_at is null or chat_id is not null)
);

create table public.bot_sessions (
  merchant_id uuid primary key references public.merchants(id),
  state text not null default 'IDLE' check(state in ('IDLE','AWAITING_PRICE')),
  intent text check(intent = 'pickup_point'),
  draft_image_path text,
  draft_price_cents integer check(draft_price_cents > 0),
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  check(state <> 'AWAITING_PRICE' or draft_image_path is not null)
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id),
  source_receipt_id uuid not null unique references public.message_receipts(id),
  slug text not null unique check(slug ~ '^[a-zA-Z0-9_-]{12,64}$'),
  label text not null check(length(label) between 1 and 160),
  image_path text not null,
  price_cents integer not null check(price_cents between 100 and 100000),
  deposit_cents integer not null check(deposit_cents >= 100 and deposit_cents <= price_cents),
  currency text not null default 'USD' check(currency = 'USD'),
  pickup_point text not null check(length(pickup_point) between 1 and 500),
  status text not null default 'available' check(status in ('available','reserved','sold','disabled')),
  created_at timestamptz not null default now(),
  unique(id,merchant_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  merchant_id uuid not null references public.merchants(id),
  buyer_id uuid not null references public.buyers(id),
  idempotency_key text not null check(length(idempotency_key) between 16 and 128),
  status text not null default 'pending_payment' check(status in
    ('pending_payment','reserved','delivered','expired','payment_failed','cancelled','payment_review')),
  payment_method text not null check(payment_method in ('deposit','cod')),
  price_cents integer not null check(price_cents > 0),
  deposit_cents integer not null check(deposit_cents >= 0 and deposit_cents <= price_cents),
  currency text not null default 'USD' check(currency = 'USD'),
  pickup_point text not null,
  terms_version text not null,
  pickup_code_hash text unique check(pickup_code_hash ~ '^[a-f0-9]{64}$'),
  checkout_expires_at timestamptz not null,
  reserved_at timestamptz,
  pickup_expires_at timestamptz,
  delivered_at timestamptz,
  expiry_reason text check(expiry_reason in ('checkout_timeout','no_show')),
  created_at timestamptz not null default now(),
  unique(buyer_id,idempotency_key),
  unique(id,merchant_id),
  foreign key(listing_id,merchant_id) references public.listings(id,merchant_id),
  check((payment_method = 'cod' and deposit_cents = 0) or (payment_method = 'deposit' and deposit_cents > 0)),
  check(checkout_expires_at > created_at),
  check(pickup_expires_at is null or (reserved_at is not null and pickup_expires_at > reserved_at)),
  check(status not in ('reserved','delivered') or (reserved_at is not null and pickup_expires_at is not null and pickup_code_hash is not null)),
  check(status <> 'delivered' or delivered_at is not null),
  check(status <> 'expired' or expiry_reason is not null)
);
create unique index one_active_order_per_listing on public.orders(listing_id)
  where status in ('pending_payment','reserved');
create index orders_expiry on public.orders(status,checkout_expires_at,pickup_expires_at);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider text not null check(provider = 'wompi_sv'),
  provider_ref text not null,
  amount_cents integer not null check(amount_cents > 0),
  currency text not null check(currency = 'USD'),
  status text not null check(status in ('pending','approved','failed','refunded','review')),
  verified_at timestamptz not null,
  provider_occurred_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider,provider_ref)
);

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  kind text not null,
  merchant_id uuid not null references public.merchants(id),
  order_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(order_id,merchant_id) references public.orders(id,merchant_id)
);
create index domain_events_reporting on public.domain_events(merchant_id,created_at,kind);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.domain_events(id),
  dedup_key text not null unique,
  recipient_chat_id text not null,
  template text not null,
  template_version text not null,
  -- Encrypted pickup-code payload if needed; never store plaintext code in events.
  payload_ciphertext text,
  due_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','processing','sending','sent','cancelled','needs_review')),
  attempts integer not null default 0 check(attempts >= 0),
  lease_token uuid,
  leased_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notification_outbox_due on public.notification_outbox(status,due_at);

create table public.settlement_entries (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id),
  order_id uuid not null,
  entry_key text not null unique,
  kind text not null check(kind in ('deposit','provider_fee','fee_subsidy','refund','compensation','payout')),
  amount_cents integer not null check(amount_cents > 0),
  currency text not null default 'USD' check(currency = 'USD'),
  status text not null default 'review' check(status in ('review','confirmed','void')),
  external_reference text,
  created_at timestamptz not null default now(),
  foreign key(order_id,merchant_id) references public.orders(id,merchant_id)
);

do $$
declare table_name text;
begin
  foreach table_name in array array['buyers','bot_sessions','listings','orders','payment_transactions',
    'domain_events','notification_outbox','settlement_entries'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated',table_name);
  end loop;
end $$;
-- No browser policies or domain RPC grants yet. This is intentionally closed until
-- ownership checks and projections are implemented and tested in the application.


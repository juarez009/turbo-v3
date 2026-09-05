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

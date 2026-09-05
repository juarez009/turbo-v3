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

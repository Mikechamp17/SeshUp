-- Core schema. Every gym-owned table carries gym_id. Money is integer cents in ZAR. Time is UTC.
-- Foreign keys from bookings, payments, refunds, and ledger rows use ON DELETE RESTRICT so history is never cascade-deleted.

create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  fee_bps integer not null default 500 check (fee_bps between 0 and 10000),
  timezone text not null default 'Africa/Johannesburg',
  paystack_subaccount_code text,
  created_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete restrict
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  name text not null default '',
  email text,
  erased_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.gym_staff (
  gym_id uuid not null references public.gyms (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null default 'owner' check (role in ('owner')),
  created_at timestamptz not null default now(),
  primary key (gym_id, user_id)
);

create table public.coaches (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.class_series (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete restrict,
  name text not null,
  description text not null default '',
  level text not null check (level in ('Beginner', 'Intermediate', 'Advanced', 'Sparring')),
  coach_id uuid references public.coaches (id) on delete restrict,
  weekdays smallint[] not null check (cardinality(weekdays) > 0 and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  start_time time not null,
  length_minutes integer not null check (length_minutes > 0),
  spot_limit integer not null check (spot_limit > 0),
  price_cents integer not null check (price_cents > 0),
  cutoff_hours integer not null default 12 check (cutoff_hours >= 0),
  ended boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete restrict,
  series_id uuid references public.class_series (id) on delete restrict,
  name text not null,
  description text not null default '',
  level text not null check (level in ('Beginner', 'Intermediate', 'Advanced', 'Sparring')),
  coach_id uuid references public.coaches (id) on delete restrict,
  local_date date not null,
  starts_at timestamptz not null,
  length_minutes integer not null check (length_minutes > 0),
  spot_limit integer not null check (spot_limit > 0),
  price_cents integer not null check (price_cents > 0),
  cutoff_hours integer not null default 12 check (cutoff_hours >= 0),
  cancelled boolean not null default false,
  time_changed boolean not null default false,
  created_at timestamptz not null default now()
);
-- One session per series per local date, so generation can be an upsert (never doubles a date).
create unique index class_sessions_series_date_key on public.class_sessions (series_id, local_date) where series_id is not null;
create index class_sessions_gym_starts_idx on public.class_sessions (gym_id, starts_at);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  member_id uuid not null references public.profiles (id) on delete restrict,
  status text not null check (status in (
    'pending', 'confirmed', 'expired', 'failed', 'refunded_late', 'released_by_gym',
    'cancelled_refund', 'cancelled_no_refund', 'cancelled_by_gym'
  )),
  hold_expires_at timestamptz,
  created_at timestamptz not null default now()
);
-- A member holds at most one active booking per class date.
create unique index bookings_one_active_per_member on public.bookings (session_id, member_id) where status in ('pending', 'confirmed');
create index bookings_session_idx on public.bookings (session_id, status);
create index bookings_member_idx on public.bookings (member_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete restrict,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  fee_cents integer not null check (fee_cents >= 0),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  provider_reference text not null unique,
  checkout_url text,
  status text not null default 'initiated' check (status in ('initiated', 'succeeded', 'failed')),
  created_at timestamptz not null default now()
);
create index payments_booking_idx on public.payments (booking_id);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  payment_id uuid references public.payments (id) on delete restrict,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Refund lifecycle: pending, submitting, submitted, then processed or failed. At most one refund per payment.
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete restrict,
  payment_id uuid not null unique references public.payments (id) on delete restrict,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  amount_cents integer not null check (amount_cents > 0),
  fee_borne_by text not null check (fee_borne_by in ('gym', 'seshup')),
  status text not null default 'pending' check (status in ('pending', 'submitting', 'submitted', 'processed', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_refund_id text,
  last_error text,
  created_at timestamptz not null default now()
);
create index refunds_due_idx on public.refunds (status, next_attempt_at);

create table public.gym_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete restrict,
  refund_id uuid not null references public.refunds (id) on delete restrict,
  entry_kind text not null check (entry_kind in ('gym_share', 'processing_fee')),
  owed_by text not null check (owed_by in ('gym', 'seshup')),
  amount_cents integer not null check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  unique (refund_id, entry_kind)
);

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  template text not null,
  recipient text not null,
  data jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index email_outbox_due_idx on public.email_outbox (next_attempt_at) where sent_at is null;

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gyms (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  member_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (session_id, member_id)
);

create table public.waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique references public.waitlist_entries (id) on delete cascade,
  gym_id uuid not null references public.gyms (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  member_id uuid not null references public.profiles (id) on delete restrict,
  offer_end timestamptz not null,
  created_at timestamptz not null default now()
);
create index waitlist_offers_session_idx on public.waitlist_offers (session_id, offer_end);

-- Profile row for every new auth user, from the sign-up name and email.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), new.email);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

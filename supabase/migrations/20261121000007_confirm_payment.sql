-- Checkout and payment confirmation. A booking keeps the price and fee rate it was made at, payments are confirmed
-- by one idempotent function, and every successful charge ends as a confirmed booking or one refund.

alter table public.bookings add column price_cents integer;
alter table public.bookings add column fee_bps integer;

-- take_spot now records the price and fee rate in force when the spot was taken.
create or replace function public.take_spot(p_session_id uuid)
returns table (booking_id uuid, outcome text, price_cents integer, fee_bps integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
  g public.gyms;
  v_taken integer;
  v_offer_end timestamptz;
  v_hold timestamptz;
  v_booking uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  select * into g from public.gyms where id = s.gym_id;

  if s.cancelled then raise exception 'session_cancelled'; end if;
  if s.starts_at <= now() then raise exception 'session_started'; end if;
  if s.starts_at > now() + interval '14 days' then raise exception 'outside_window'; end if;
  if g.paystack_subaccount_code is null then raise exception 'gym_not_connected'; end if;

  update public.bookings set status = 'expired'
  where session_id = s.id and status = 'pending'
    and (hold_expires_at + interval '3 minutes' <= now() or (member_id = v_uid and hold_expires_at <= now()));

  if exists (
    select 1 from public.bookings
    where session_id = s.id and member_id = v_uid and status in ('pending', 'confirmed')
  ) then
    raise exception 'already_booked';
  end if;

  select o.offer_end into v_offer_end
  from public.waitlist_offers o
  where o.session_id = s.id and o.member_id = v_uid and o.offer_end > now();

  v_taken := public.spots_taken(s.id);
  if v_offer_end is not null then v_taken := v_taken - 1; end if;

  if v_taken >= s.spot_limit then
    return query select null::uuid, 'full'::text, s.price_cents, g.fee_bps;
    return;
  end if;

  v_hold := now() + interval '10 minutes';
  if v_offer_end is not null then v_hold := least(v_hold, v_offer_end); end if;

  insert into public.bookings (gym_id, session_id, member_id, status, hold_expires_at, price_cents, fee_bps)
  values (s.gym_id, s.id, v_uid, 'pending', v_hold, s.price_cents, g.fee_bps)
  returning id into v_booking;

  return query select v_booking, 'booked'::text, s.price_cents, g.fee_bps;
end $$;

-- Creates the payment row for a booking. The amount is the price recorded on the booking, never a value from the request.
create function public.create_payment(p_booking_id uuid, p_fee_cents integer) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.bookings;
  v_id uuid;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found or b.status <> 'pending' then raise exception 'booking_not_pending'; end if;
  if p_fee_cents < 0 or p_fee_cents > b.price_cents then raise exception 'invalid_fee'; end if;
  insert into public.payments (gym_id, booking_id, amount_cents, fee_cents, provider_reference)
  values (b.gym_id, b.id, b.price_cents, p_fee_cents, b.id::text)
  returning id into v_id;
  return v_id;
end $$;

create function public.set_checkout_url(p_booking_id uuid, p_url text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.payments set checkout_url = p_url where booking_id = p_booking_id
$$;

-- A booking whose checkout could not start frees its spot at once.
create function public.release_booking(p_booking_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.bookings set status = 'failed' where id = p_booking_id and status = 'pending'
$$;

-- Member-facing: the checkout link of the caller's own live pending booking on a date, if there is one.
create function public.get_resume_checkout(p_session_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select p.checkout_url
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  where b.session_id = p_session_id and b.member_id = auth.uid()
    and b.status = 'pending' and b.hold_expires_at > now() and p.status = 'initiated'
  limit 1
$$;

-- Audit record of a provider event. True when the event is new.
create function public.record_payment_event(p_event_key text, p_reference text, p_payload jsonb) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inserted integer;
begin
  insert into public.payment_events (event_key, payment_id, payload)
  values (p_event_key, (select id from public.payments where provider_reference = p_reference), p_payload)
  on conflict (event_key) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end $$;

-- Applies a verified payment result. Idempotent, and safe to call from the webhook and the return page at once.
-- Every success ends as one confirmed booking or one refund; a mismatch changes nothing and is recorded.
create function public.confirm_payment(
  p_reference text, p_status text, p_amount_cents integer, p_currency text, p_subaccount_code text, p_charge_cents integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pay public.payments;
  b public.bookings;
  s public.class_sessions;
  g public.gyms;
  prof public.profiles;
  v_session uuid;
  v_taken integer;
  v_self_counted boolean;
  v_offer boolean;
  v_ok boolean;
  v_borne text := 'seshup';
  v_data jsonb;
begin
  select * into pay from public.payments where provider_reference = p_reference;
  if not found then raise exception 'unknown_payment'; end if;

  -- Lock order: session, then booking.
  select session_id into v_session from public.bookings where id = pay.booking_id;
  select * into s from public.class_sessions where id = v_session for update;
  select * into b from public.bookings where id = pay.booking_id for update;
  select * into pay from public.payments where id = pay.id for update;
  select * into g from public.gyms where id = s.gym_id;

  if pay.status = 'succeeded' then
    return jsonb_build_object('outcome', 'already_processed', 'booking_status', b.status);
  end if;

  if p_status = 'pending' then
    return jsonb_build_object('outcome', 'pending', 'booking_status', b.status);
  end if;

  if p_status = 'failed' then
    update public.payments set status = 'failed' where id = pay.id;
    if b.status = 'pending' then
      update public.bookings set status = 'failed' where id = b.id;
      b.status := 'failed';
    end if;
    return jsonb_build_object('outcome', 'failed', 'booking_status', b.status);
  end if;

  -- A success is trusted only when currency, amount, sub-account, and fee all match what SeshUp stored.
  if p_currency is distinct from 'ZAR'
     or p_amount_cents is distinct from pay.amount_cents
     or p_subaccount_code is distinct from g.paystack_subaccount_code
     or p_charge_cents is distinct from pay.fee_cents then
    insert into public.payment_events (event_key, payment_id, payload)
    values ('mismatch:' || pay.id::text || ':' || gen_random_uuid()::text, pay.id,
            jsonb_build_object('reference', p_reference, 'currency', p_currency, 'amount_cents', p_amount_cents,
                               'subaccount', p_subaccount_code, 'charge_cents', p_charge_cents));
    return jsonb_build_object('outcome', 'mismatch', 'booking_status', b.status);
  end if;

  update public.payments set status = 'succeeded' where id = pay.id;
  select * into prof from public.profiles where id = b.member_id;
  v_data := jsonb_build_object('gymName', g.name, 'className', s.name, 'startsAt', s.starts_at,
                               'timezone', g.timezone, 'amountCents', pay.amount_cents);

  if b.status = 'confirmed' then
    return jsonb_build_object('outcome', 'already_processed', 'booking_status', b.status);
  end if;

  if s.cancelled or b.status = 'released_by_gym' then
    v_ok := false;
    v_borne := 'gym';
  elsif s.starts_at <= now() then
    v_ok := false;
  elsif exists (
    select 1 from public.bookings o
    where o.session_id = s.id and o.member_id = b.member_id and o.id <> b.id and o.status in ('pending', 'confirmed')
  ) then
    v_ok := false;
  else
    -- Their own live hold already counts as taken, and so does a waitlist offer when they hold no live booking.
    v_self_counted := b.status = 'pending' and b.hold_expires_at + interval '3 minutes' > now();
    v_offer := exists (
      select 1 from public.waitlist_offers w where w.session_id = s.id and w.member_id = b.member_id and w.offer_end > now()
    );
    v_taken := public.spots_taken(s.id)
      - case when v_self_counted then 1 else 0 end
      - case when (not v_self_counted) and v_offer then 1 else 0 end;
    v_ok := v_taken < s.spot_limit;
  end if;

  if v_ok then
    update public.bookings set status = 'confirmed' where id = b.id;
    delete from public.waitlist_entries where session_id = s.id and member_id = b.member_id;
    if prof.email is not null then
      insert into public.email_outbox (template, recipient, data) values ('booking_confirmed', prof.email, v_data);
    end if;
    return jsonb_build_object('outcome', 'confirmed', 'booking_status', 'confirmed');
  end if;

  update public.bookings set status = 'refunded_late' where id = b.id;
  insert into public.refunds (gym_id, payment_id, booking_id, amount_cents, fee_borne_by)
  values (b.gym_id, pay.id, b.id, pay.amount_cents, v_borne);
  if prof.email is not null then
    insert into public.email_outbox (template, recipient, data) values ('late_payment_refund', prof.email, v_data);
  end if;
  return jsonb_build_object('outcome', 'refunded_late', 'booking_status', 'refunded_late');
end $$;

-- Payments that may have been paid without us hearing, to be checked against the provider by the job route.
create function public.pending_payments_to_check() returns table (provider_reference text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.provider_reference
  from public.payments p
  join public.bookings b on b.id = p.booking_id
  where p.status = 'initiated' and b.status in ('pending', 'expired')
    and p.created_at > now() - interval '2 hours'
  order by p.created_at
  limit 50
$$;

-- Per-minute tidy: keep every series' dates filled and release holds past their grace. Later work extends this.
create or replace function public.tidy() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._generate_all_sessions();
  update public.bookings set status = 'expired'
  where status = 'pending' and hold_expires_at + interval '3 minutes' <= now();
end $$;

revoke execute on function public.create_payment(uuid, integer) from public, anon, authenticated;
revoke execute on function public.set_checkout_url(uuid, text) from public, anon, authenticated;
revoke execute on function public.release_booking(uuid) from public, anon, authenticated;
revoke execute on function public.get_resume_checkout(uuid) from public, anon;
revoke execute on function public.record_payment_event(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.confirm_payment(text, text, integer, text, text, integer) from public, anon, authenticated;
revoke execute on function public.pending_payments_to_check() from public, anon, authenticated;
grant execute on function public.get_resume_checkout(uuid) to authenticated;
grant execute on function public.create_payment(uuid, integer), public.set_checkout_url(uuid, text), public.release_booking(uuid),
  public.record_payment_event(text, text, jsonb), public.confirm_payment(text, text, integer, text, text, integer),
  public.pending_payments_to_check() to service_role;

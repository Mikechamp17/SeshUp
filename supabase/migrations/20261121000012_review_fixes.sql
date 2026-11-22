-- Fixes from code review: moved series dates stay in their slot, payment mismatches are held for review and shown to the
-- operator, refunds are always checked at the provider before a retry and re-polled while submitted, erasure covers queued mail,
-- members cannot read payout columns of gyms, and late-payment refunds send one correct email.

alter table public.class_sessions add column series_date date;
update public.class_sessions set series_date = local_date where series_id is not null;
drop index public.class_sessions_series_date_key;
create unique index class_sessions_series_date_key on public.class_sessions (series_id, series_date) where series_id is not null;

-- A date generated for a series keeps its slot (series_date) even after the owner moves it to another day.
create or replace function public._generate_series_sessions(p_series uuid, p_days integer default 16) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ser public.class_series;
  g public.gyms;
  d date;
  v_today date;
  v_start timestamptz;
  v_count integer := 0;
  v_rows integer;
begin
  select * into ser from public.class_series where id = p_series and not ended;
  if not found then return 0; end if;
  select * into g from public.gyms where id = ser.gym_id;
  v_today := (now() at time zone g.timezone)::date;

  for d in select generate_series(v_today, v_today + p_days, interval '1 day')::date loop
    if extract(isodow from d)::integer = any (ser.weekdays) then
      v_start := (d + ser.start_time) at time zone g.timezone;
      if v_start > now() then
        insert into public.class_sessions
          (gym_id, series_id, series_date, name, description, level, coach_id, local_date, starts_at, length_minutes, spot_limit, price_cents, cutoff_hours)
        values
          (ser.gym_id, ser.id, d, ser.name, ser.description, ser.level, ser.coach_id, d, v_start, ser.length_minutes, ser.spot_limit, ser.price_cents, ser.cutoff_hours)
        on conflict (series_id, series_date) where series_id is not null do nothing;
        get diagnostics v_rows = row_count;
        v_count := v_count + v_rows;
      end if;
    end if;
  end loop;
  return v_count;
end $$;

alter table public.payments drop constraint payments_status_check;
alter table public.payments add constraint payments_status_check check (status in ('initiated', 'succeeded', 'failed', 'needs_review'));
alter table public.refunds add column notify_on_processed boolean not null default true;

-- A payment held for review is not re-polled, and a late refund is explained by one email with no second one after.
create or replace function public.confirm_payment(
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
    update public.payments set status = 'needs_review' where id = pay.id;
    insert into public.payment_events (event_key, payment_id, payload)
    values ('mismatch:' || pay.id::text, pay.id,
            jsonb_build_object('reference', p_reference, 'currency', p_currency, 'amount_cents', p_amount_cents,
                               'subaccount', p_subaccount_code, 'charge_cents', p_charge_cents))
    on conflict (event_key) do nothing;
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
  insert into public.refunds (gym_id, payment_id, booking_id, amount_cents, fee_borne_by, notify_on_processed)
  values (b.gym_id, pay.id, b.id, pay.amount_cents, v_borne, false);
  if prof.email is not null then
    insert into public.email_outbox (template, recipient, data)
    values (case when s.cancelled then 'class_cancelled_by_gym' else 'late_payment_refund' end, prof.email, v_data);
  end if;
  return jsonb_build_object('outcome', 'refunded_late', 'booking_status', 'refunded_late');
end $$;

-- Any refund attempted before is checked at the provider first, and a submitted refund is polled until it is processed.
create or replace function public.claim_due_refunds(p_limit integer)
returns table (refund_id uuid, reference text, amount_cents integer, was_submitting boolean)
language sql security definer set search_path = public, pg_temp as $$
  with due as (
    select r.id, (r.status in ('submitting', 'submitted') or r.attempts > 0) as was_submitting
    from public.refunds r
    where r.status in ('pending', 'submitting', 'submitted') and r.next_attempt_at <= now() and r.attempts < 8
    order by r.next_attempt_at, r.created_at
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.refunds r
    set status = 'submitting', attempts = r.attempts + 1, next_attempt_at = now() + interval '5 minutes'
    from due where r.id = due.id
    returning r.id, r.payment_id, r.amount_cents, due.was_submitting
  )
  select c.id, p.provider_reference, c.amount_cents, c.was_submitting
  from claimed c join public.payments p on p.id = c.payment_id
$$;

create or replace function public.complete_refund(p_refund_id uuid, p_provider_refund_id text, p_processed boolean, p_processing_fee_cents integer default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.refunds;
  pay public.payments;
  b public.bookings;
  s public.class_sessions;
  g public.gyms;
  prof public.profiles;
begin
  select * into r from public.refunds where id = p_refund_id for update;
  if not found or r.status = 'processed' then return; end if;

  if not p_processed then
    update public.refunds set status = 'submitted', provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id), last_error = null,
      next_attempt_at = now() + interval '15 minutes'
    where id = r.id;
    return;
  end if;

  update public.refunds
  set status = 'processed', provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id), last_error = null
  where id = r.id;

  select * into pay from public.payments where id = r.payment_id;
  -- The gym's share is what the payment sent to the gym's account. SeshUp funded it out of its own balance.
  insert into public.gym_ledger_entries (gym_id, refund_id, entry_kind, owed_by, amount_cents)
  values (r.gym_id, r.id, 'gym_share', 'gym', greatest(r.amount_cents - pay.fee_cents, 0))
  on conflict (refund_id, entry_kind) do nothing;
  insert into public.gym_ledger_entries (gym_id, refund_id, entry_kind, owed_by, amount_cents)
  values (r.gym_id, r.id, 'processing_fee', r.fee_borne_by, coalesce(p_processing_fee_cents, 0))
  on conflict (refund_id, entry_kind) do nothing;

  -- Late-payment refunds were already explained by their own email.
  if r.notify_on_processed then
    select * into b from public.bookings where id = r.booking_id;
    select * into s from public.class_sessions where id = b.session_id;
    select * into g from public.gyms where id = s.gym_id;
    select * into prof from public.profiles where id = b.member_id;
    if prof.email is not null then
      insert into public.email_outbox (template, recipient, data)
      values ('refund_processed', prof.email, public._email_data(s, g, r.amount_cents));
    end if;
  end if;
end $$;

-- Mail already queued for the erased address is rewritten, and unsent mail is never delivered.
create or replace function public.erase_member(p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old text;
begin
  select email into v_old from public.profiles where id = p_member;
  update public.profiles
  set name = 'Erased member', email = null, erased_at = now()
  where id = p_member;
  update auth.users
  set email = 'erased-' || p_member::text || '@erased.invalid', raw_user_meta_data = '{}'::jsonb
  where id = p_member;
  update public.email_outbox
  set recipient = 'erased-' || p_member::text || '@erased.invalid', data = '{}'::jsonb, sent_at = coalesce(sent_at, now())
  where v_old is not null and recipient = v_old;
end $$;

revoke select on public.gyms from authenticated;
grant select (id, name, slug, timezone, created_at) on public.gyms to authenticated;

-- The operator also sees payments held for review, refunds stuck after submission, and refunds the job route has not sent.
create or replace function public.operator_problems()
returns table (kind text, gym_id uuid, gym_name text, ref_id uuid, attempts integer, detail text)
language sql stable security definer set search_path = public, pg_temp as $$
  select 'gym_not_connected'::text, g.id, g.name, g.id, 0, 'No payment account connected'::text
  from public.gyms g
  where g.paystack_subaccount_code is null
  union all
  select 'refund_failed'::text, r.gym_id, g.name, r.id, r.attempts, coalesce(r.last_error, r.status)
  from public.refunds r
  join public.gyms g on g.id = r.gym_id
  where r.status = 'failed' or (r.attempts >= 5 and r.status <> 'processed')
  union all
  select 'payment_mismatch'::text, p.gym_id, g.name, p.id, 0, 'Paid, but the provider reported a different amount, fee or account'::text
  from public.payments p
  join public.gyms g on g.id = p.gym_id
  where p.status = 'needs_review'
  union all
  select 'refund_stuck'::text, r.gym_id, g.name, r.id, r.attempts, 'Submitted to the provider more than a day ago and not confirmed'::text
  from public.refunds r
  join public.gyms g on g.id = r.gym_id
  where r.status = 'submitted' and r.created_at < now() - interval '1 day'
  union all
  select 'refund_overdue'::text, r.gym_id, g.name, r.id, r.attempts, 'Waiting to be sent for over 15 minutes: is the job route running?'::text
  from public.refunds r
  join public.gyms g on g.id = r.gym_id
  where r.status = 'pending' and r.next_attempt_at < now() - interval '15 minutes'
  union all
  select 'email_dead'::text, null::uuid, null::text, o.id, o.attempts,
    o.template || coalesce(': ' || left(o.last_error, 200), '')
  from public.email_outbox o
  where o.attempts >= 8 and o.sent_at is null
$$;

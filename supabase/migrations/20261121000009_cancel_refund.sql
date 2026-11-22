-- Cancellations, owner cancel, the refund lifecycle, and the gym ledger.
-- Refund status: pending, submitting, submitted, then processed or failed. A payment has at most one refund.
-- Status changes are conditional, so when two cancels race the loser does nothing.

-- Whether cancelling this date now earns a refund: before the cutoff, or any time on a date whose time was changed.
create function public._refund_applies(s public.class_sessions) returns boolean
language sql stable as $$
  select s.time_changed or now() <= s.starts_at - make_interval(hours => s.cutoff_hours)
$$;

-- Member-facing: would cancelling this booking now be refunded?
create function public.booking_refundable(p_booking_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public._refund_applies(s)
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  where b.id = p_booking_id and b.member_id = auth.uid()
$$;

create function public._email_data(s public.class_sessions, g public.gyms, p_amount integer, p_new_start timestamptz default null)
returns jsonb language sql stable as $$
  select jsonb_build_object('gymName', g.name, 'className', s.name, 'startsAt', s.starts_at, 'timezone', g.timezone,
                            'amountCents', p_amount)
$$;

-- Member-facing: cancel the caller's own confirmed booking. Refunded in full before the cutoff, never after.
create function public.cancel_booking(p_booking_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid;
  s public.class_sessions;
  b public.bookings;
  g public.gyms;
  pay public.payments;
  prof public.profiles;
  v_refund boolean;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select session_id into v_session from public.bookings where id = p_booking_id and member_id = v_uid;
  if v_session is null then raise exception 'booking_not_found'; end if;

  -- Lock order: session, then booking.
  select * into s from public.class_sessions where id = v_session for update;
  select * into b from public.bookings where id = p_booking_id for update;
  if b.status <> 'confirmed' then
    return jsonb_build_object('outcome', 'noop', 'booking_status', b.status);
  end if;
  if s.starts_at <= now() then raise exception 'session_started'; end if;

  select * into g from public.gyms where id = s.gym_id;
  select * into pay from public.payments where booking_id = b.id and status = 'succeeded';
  select * into prof from public.profiles where id = v_uid;
  v_refund := public._refund_applies(s);

  if v_refund then
    if pay.id is null then raise exception 'no_payment'; end if;
    update public.bookings set status = 'cancelled_refund' where id = b.id;
    insert into public.refunds (gym_id, payment_id, booking_id, amount_cents, fee_borne_by)
    values (b.gym_id, pay.id, b.id, pay.amount_cents, 'gym');
    if prof.email is not null then
      insert into public.email_outbox (template, recipient, data)
      values ('booking_cancelled_refund', prof.email, public._email_data(s, g, pay.amount_cents));
    end if;
    return jsonb_build_object('outcome', 'refund', 'booking_status', 'cancelled_refund');
  end if;

  update public.bookings set status = 'cancelled_no_refund' where id = b.id;
  if prof.email is not null then
    insert into public.email_outbox (template, recipient, data)
    values ('booking_cancelled_no_refund', prof.email, public._email_data(s, g, null));
  end if;
  return jsonb_build_object('outcome', 'no_refund', 'booking_status', 'cancelled_no_refund');
end $$;

-- Owner-facing: what cancelling this date would do, so the owner can confirm it.
create function public.cancel_preview(p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.class_sessions where id = p_session_id;
  if v_gym is null or not exists (select 1 from public.gym_staff where gym_id = v_gym and user_id = auth.uid()) then
    raise exception 'not_staff';
  end if;
  return jsonb_build_object(
    'booked', (select count(*) from public.bookings where session_id = p_session_id and status = 'confirmed'),
    'refund_total_cents', coalesce((
      select sum(p.amount_cents) from public.bookings b
      join public.payments p on p.booking_id = b.id and p.status = 'succeeded'
      where b.session_id = p_session_id and b.status = 'confirmed'), 0),
    'waitlisted', (select count(*) from public.waitlist_entries where session_id = p_session_id)
  );
end $$;

-- Owner-facing: cancel a date. Every confirmed member gets a full refund and an email whatever the cutoff.
create function public.owner_cancel_session(p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.class_sessions;
  g public.gyms;
  r record;
  v_count integer := 0;
  v_total integer := 0;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if not exists (select 1 from public.gym_staff where gym_id = s.gym_id and user_id = auth.uid()) then
    raise exception 'not_staff';
  end if;
  if s.cancelled then return jsonb_build_object('outcome', 'noop', 'refunded', 0, 'total_cents', 0); end if;
  select * into g from public.gyms where id = s.gym_id;

  update public.class_sessions set cancelled = true where id = s.id;

  for r in
    select b.id as booking_id, p.id as payment_id, p.amount_cents, pr.email
    from public.bookings b
    join public.payments p on p.booking_id = b.id and p.status = 'succeeded'
    left join public.profiles pr on pr.id = b.member_id
    where b.session_id = s.id and b.status = 'confirmed'
    order by b.id
    for update of b
  loop
    update public.bookings set status = 'cancelled_by_gym' where id = r.booking_id and status = 'confirmed';
    insert into public.refunds (gym_id, payment_id, booking_id, amount_cents, fee_borne_by)
    values (s.gym_id, r.payment_id, r.booking_id, r.amount_cents, 'gym');
    if r.email is not null then
      insert into public.email_outbox (template, recipient, data)
      values ('class_cancelled_by_gym', r.email, public._email_data(s, g, r.amount_cents));
    end if;
    v_count := v_count + 1;
    v_total := v_total + r.amount_cents;
  end loop;

  -- Members still paying are released. A late payment will be refunded by the confirm step.
  update public.bookings set status = 'released_by_gym' where session_id = s.id and status = 'pending';
  -- Waitlist entries and their offers close with no emails.
  delete from public.waitlist_entries where session_id = s.id;

  return jsonb_build_object('outcome', 'cancelled', 'refunded', v_count, 'total_cents', v_total);
end $$;

-- Claims due refunds for the job. A refund left in 'submitting' by a crashed run is claimed again once its lease ends.
create function public.claim_due_refunds(p_limit integer)
returns table (refund_id uuid, reference text, amount_cents integer, was_submitting boolean)
language sql security definer set search_path = public, pg_temp as $$
  with due as (
    select r.id, (r.status = 'submitting') as was_submitting
    from public.refunds r
    where r.status in ('pending', 'submitting') and r.next_attempt_at <= now() and r.attempts < 8
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

-- The provider accepted the refund (submitted) or finished it (processed). Ledger rows and the member's email are
-- written only in the transaction that moves the refund to processed, and only once.
create function public.complete_refund(p_refund_id uuid, p_provider_refund_id text, p_processed boolean, p_processing_fee_cents integer default null)
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
    update public.refunds set status = 'submitted', provider_refund_id = coalesce(p_provider_refund_id, provider_refund_id), last_error = null
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
  if r.fee_borne_by = 'gym' then
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

-- A refund the provider could not do yet goes back to pending with a delay. After 8 tries it stays failed for the operator.
create function public.fail_refund(p_refund_id uuid, p_error text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.refunds
  set status = case when attempts >= 8 then 'failed' else 'pending' end,
      last_error = left(p_error, 500),
      next_attempt_at = now() + least(power(2, attempts) * interval '1 minute', interval '1 hour')
  where id = p_refund_id and status in ('pending', 'submitting', 'submitted')
$$;

-- Provider refund events, by the payment's reference.
create function public.settle_refund_by_reference(p_reference text, p_outcome text, p_provider_refund_id text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_refund uuid;
begin
  select r.id into v_refund from public.refunds r join public.payments p on p.id = r.payment_id
  where p.provider_reference = p_reference;
  if v_refund is null then return; end if;
  if p_outcome = 'processed' then
    perform public.complete_refund(v_refund, p_provider_refund_id, true);
  elsif p_outcome = 'failed' then
    update public.refunds set status = 'failed', last_error = 'provider reported the refund failed'
    where id = v_refund and status in ('pending', 'submitting', 'submitted');
  end if;
end $$;

revoke execute on function public._refund_applies(public.class_sessions) from public, anon, authenticated;
revoke execute on function public._email_data(public.class_sessions, public.gyms, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.booking_refundable(uuid) from public, anon;
revoke execute on function public.cancel_booking(uuid) from public, anon;
revoke execute on function public.cancel_preview(uuid) from public, anon;
revoke execute on function public.owner_cancel_session(uuid) from public, anon;
revoke execute on function public.claim_due_refunds(integer) from public, anon, authenticated;
revoke execute on function public.complete_refund(uuid, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.fail_refund(uuid, text) from public, anon, authenticated;
revoke execute on function public.settle_refund_by_reference(text, text, text) from public, anon, authenticated;
grant execute on function public.booking_refundable(uuid), public.cancel_booking(uuid), public.cancel_preview(uuid),
  public.owner_cancel_session(uuid) to authenticated;
grant execute on function public.claim_due_refunds(integer), public.complete_refund(uuid, text, boolean, integer),
  public.fail_refund(uuid, text), public.settle_refund_by_reference(text, text, text) to service_role;

-- Operator area: monthly gym statement, problems list, and account lookup by email.
-- Each function is executable by service_role only. Execute is revoked per function so no other migration's grants are touched.

-- The statement for one gym and one calendar month in the gym's own time zone.
-- p_month is any date in the month. Entries are counted by the gym-local month of their creation.
create function public.gym_statement(p_gym uuid, p_month date)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  g public.gyms;
  v_start date := date_trunc('month', p_month)::date;
  v_from timestamptz;
  v_to timestamptz;
  v_entries jsonb;
  v_gym_cents bigint;
  v_seshup_cents bigint;
begin
  select * into g from public.gyms where id = p_gym;
  if not found then raise exception 'gym_not_found'; end if;

  -- A timestamp without a zone, read "at time zone" the gym's zone, is that local midnight as an instant.
  v_from := v_start::timestamp at time zone g.timezone;
  v_to := (v_start + interval '1 month')::timestamp at time zone g.timezone;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'entry_kind', e.entry_kind,
      'owed_by', e.owed_by,
      'amount_cents', e.amount_cents,
      'created_at', e.created_at,
      'local_date', (e.created_at at time zone g.timezone)::date,
      'refund_id', r.id,
      'refund_status', r.status,
      'refund_amount_cents', r.amount_cents,
      'booking_id', r.booking_id,
      'class_name', s.name,
      'class_local_date', s.local_date
    ) order by e.created_at, e.id), '[]'::jsonb),
    coalesce(sum(e.amount_cents) filter (where e.owed_by = 'gym'), 0),
    coalesce(sum(e.amount_cents) filter (where e.owed_by = 'seshup'), 0)
  into v_entries, v_gym_cents, v_seshup_cents
  from public.gym_ledger_entries e
  join public.refunds r on r.id = e.refund_id
  join public.bookings b on b.id = r.booking_id
  join public.class_sessions s on s.id = b.session_id
  where e.gym_id = p_gym and e.created_at >= v_from and e.created_at < v_to;

  return jsonb_build_object(
    'gym_id', g.id,
    'gym_name', g.name,
    'timezone', g.timezone,
    'month_start', v_start,
    'gym_owes_cents', v_gym_cents,
    'seshup_absorbed_cents', v_seshup_cents,
    'entries', v_entries
  );
end $$;

-- Things the operator should look at: gyms that cannot take bookings, refunds that keep failing, emails that gave up.
create function public.operator_problems()
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
  select 'email_dead'::text, null::uuid, null::text, o.id, o.attempts,
    o.template || coalesce(': ' || left(o.last_error, 200), '')
  from public.email_outbox o
  where o.attempts >= 8 and o.sent_at is null
$$;

-- Finds an account by email, case-insensitively, and says whether its email is confirmed.
create function public.operator_find_user(p_email text)
returns table (user_id uuid, confirmed boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, u.email_confirmed_at is not null
  from auth.users u
  where lower(u.email) = lower(p_email)
  limit 1
$$;

revoke execute on function public.gym_statement(uuid, date) from public, anon, authenticated;
grant execute on function public.gym_statement(uuid, date) to service_role;
revoke execute on function public.operator_problems() from public, anon, authenticated;
grant execute on function public.operator_problems() to service_role;
revoke execute on function public.operator_find_user(text) from public, anon, authenticated;
grant execute on function public.operator_find_user(text) to service_role;

-- Owner class management: add a class for one date only, and stop a repeating class.
-- Owners cannot insert class dates directly (they may only update a few columns), so both go through functions
-- that check the caller is staff of the gym, in the same way as update_series.

-- Owner-facing: add one date with no repeating class behind it. The local day is the gym's day, not the UTC day.
create function public.create_one_off_class(
  p_gym uuid, p_name text, p_description text, p_level text, p_coach uuid, p_start timestamptz,
  p_length integer, p_spot_limit integer, p_price integer, p_cutoff integer
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.gyms;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into g from public.gyms where id = p_gym;
  if not found or not exists (select 1 from public.gym_staff where gym_id = p_gym and user_id = auth.uid()) then
    raise exception 'not_staff';
  end if;
  if p_start <= now() then raise exception 'time_in_past'; end if;

  insert into public.class_sessions
    (gym_id, name, description, level, coach_id, local_date, starts_at, length_minutes, spot_limit, price_cents, cutoff_hours)
  values
    (p_gym, p_name, coalesce(p_description, ''), p_level, p_coach, (p_start at time zone g.timezone)::date, p_start,
     p_length, p_spot_limit, p_price, p_cutoff)
  returning id into v_id;
  return v_id;
end $$;

-- Owner-facing: stop a repeating class. No new dates are made for it, and future dates nobody has booked are removed.
-- A date with any booking, a waitlist entry, or a cancellation stays. Each date is locked and rechecked before it is
-- deleted, so a booking that is in flight wins. Returns how many dates were removed and how many future dates remain.
create function public.end_series(p_series uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ser public.class_series;
  s record;
  v_removed integer := 0;
  v_kept integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into ser from public.class_series where id = p_series for update;
  if not found then raise exception 'series_not_found'; end if;
  if not exists (select 1 from public.gym_staff where gym_id = ser.gym_id and user_id = auth.uid()) then
    raise exception 'not_staff';
  end if;

  update public.class_series set ended = true where id = ser.id;

  for s in
    select id from public.class_sessions where series_id = ser.id and starts_at > now() order by id
  loop
    -- Lock the date first, then look again: lock order is always date, then booking.
    perform 1 from public.class_sessions where id = s.id for update;
    continue when exists (select 1 from public.class_sessions where id = s.id and cancelled)
      or exists (select 1 from public.bookings where session_id = s.id)
      or exists (select 1 from public.waitlist_entries where session_id = s.id)
      or exists (select 1 from public.waitlist_offers where session_id = s.id);
    delete from public.class_sessions where id = s.id;
    v_removed := v_removed + 1;
  end loop;

  select count(*) into v_kept from public.class_sessions where series_id = ser.id and starts_at > now();
  return jsonb_build_object('removed', v_removed, 'kept', v_kept);
end $$;

revoke execute on function public.create_one_off_class(uuid, text, text, text, uuid, timestamptz, integer, integer, integer, integer) from public, anon;
revoke execute on function public.end_series(uuid) from public, anon;
grant execute on function public.create_one_off_class(uuid, text, text, text, uuid, timestamptz, integer, integer, integer, integer) to authenticated;
grant execute on function public.end_series(uuid) to authenticated;

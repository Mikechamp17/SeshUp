-- Class series become one session row per date. Series edits, single-date edits, and time changes.

alter table public.class_sessions add column edited boolean not null default false;

-- A coach must belong to the same gym as the series or session that uses them.
create function public.check_coach_gym() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.coach_id is not null
     and not exists (select 1 from public.coaches where id = new.coach_id and gym_id = new.gym_id) then
    raise exception 'coach_wrong_gym';
  end if;
  return new;
end $$;

create trigger class_series_coach_gym before insert or update of coach_id, gym_id on public.class_series
  for each row execute function public.check_coach_gym();
create trigger class_sessions_coach_gym before insert or update of coach_id, gym_id on public.class_sessions
  for each row execute function public.check_coach_gym();

-- A change made to one date of a series marks it as edited, so a later series edit leaves it alone.
-- The series update itself sets seshup.series_update so it does not mark every date as edited.
create function public.mark_session_edited() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.series_id is not null
     and coalesce(current_setting('seshup.series_update', true), '') <> 'on'
     and (new.name, new.description, new.level, new.coach_id, new.starts_at, new.length_minutes, new.spot_limit,
          new.price_cents, new.cutoff_hours, new.cancelled)
         is distinct from
         (old.name, old.description, old.level, old.coach_id, old.starts_at, old.length_minutes, old.spot_limit,
          old.price_cents, old.cutoff_hours, old.cancelled) then
    new.edited := true;
  end if;
  return new;
end $$;

create trigger class_sessions_mark_edited before update on public.class_sessions
  for each row execute function public.mark_session_edited();

-- Generates the dated sessions for one series, from today to p_days ahead in the gym's time zone.
-- Existing dates are left exactly as they are, so generation can run any number of times.
create function public._generate_series_sessions(p_series uuid, p_days integer default 16) returns integer
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
          (gym_id, series_id, name, description, level, coach_id, local_date, starts_at, length_minutes, spot_limit, price_cents, cutoff_hours)
        values
          (ser.gym_id, ser.id, ser.name, ser.description, ser.level, ser.coach_id, d, v_start, ser.length_minutes, ser.spot_limit, ser.price_cents, ser.cutoff_hours)
        on conflict (series_id, local_date) where series_id is not null do nothing;
        get diagnostics v_rows = row_count;
        v_count := v_count + v_rows;
      end if;
    end if;
  end loop;
  return v_count;
end $$;

create function public._generate_all_sessions() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  for r in select id from public.class_series where not ended order by id loop
    perform public._generate_series_sessions(r.id);
  end loop;
end $$;

-- Owner-facing: generate the sessions of one of the caller's own series.
create function public.generate_my_series_sessions(p_series uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ser public.class_series;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into ser from public.class_series where id = p_series;
  if not found then raise exception 'series_not_found'; end if;
  if not exists (select 1 from public.gym_staff where gym_id = ser.gym_id and user_id = auth.uid()) then
    raise exception 'not_staff';
  end if;
  return public._generate_series_sessions(p_series);
end $$;

-- Owner-facing: change a series. Future dates with no bookings, no waitlist, and no single-date edits follow the
-- new settings. Every other date keeps its values. Each date is locked and re-checked, so a booking that
-- is in flight wins and the date stays as it was.
create function public.update_series(
  p_series uuid, p_name text, p_description text, p_level text, p_coach uuid, p_weekdays smallint[],
  p_start_time time, p_length integer, p_spot_limit integer, p_price integer, p_cutoff integer
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ser public.class_series;
  g public.gyms;
  s public.class_sessions;
  v_start timestamptz;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into ser from public.class_series where id = p_series for update;
  if not found then raise exception 'series_not_found'; end if;
  if not exists (select 1 from public.gym_staff where gym_id = ser.gym_id and user_id = auth.uid()) then
    raise exception 'not_staff';
  end if;
  select * into g from public.gyms where id = ser.gym_id;

  update public.class_series
  set name = p_name, description = p_description, level = p_level, coach_id = p_coach, weekdays = p_weekdays,
      start_time = p_start_time, length_minutes = p_length, spot_limit = p_spot_limit, price_cents = p_price,
      cutoff_hours = p_cutoff
  where id = ser.id;

  perform set_config('seshup.series_update', 'on', true);
  for s in
    select * from public.class_sessions
    where series_id = ser.id and starts_at > now() and not cancelled and not edited
    order by id
  loop
    -- Lock the date, then re-read it: a booking may have arrived since the list was taken.
    select * into s from public.class_sessions where id = s.id for update;
    continue when s.edited or s.cancelled or s.starts_at <= now();
    continue when exists (select 1 from public.bookings where session_id = s.id and status in ('pending', 'confirmed'))
      or exists (select 1 from public.waitlist_entries where session_id = s.id)
      or exists (select 1 from public.bookings where session_id = s.id);

    if extract(isodow from s.local_date)::integer = any (p_weekdays) then
      v_start := (s.local_date + p_start_time) at time zone g.timezone;
      update public.class_sessions
      set name = p_name, description = p_description, level = p_level, coach_id = p_coach, starts_at = v_start,
          length_minutes = p_length, spot_limit = p_spot_limit, price_cents = p_price, cutoff_hours = p_cutoff
      where id = s.id;
    else
      delete from public.class_sessions where id = s.id;
    end if;
  end loop;
  perform set_config('seshup.series_update', 'off', true);

  perform public._generate_series_sessions(ser.id);
end $$;

-- Owner-facing: move one date to a new time. Booked members are emailed and may cancel with a full refund.
create function public.change_session_time(p_session_id uuid, p_new_start timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.class_sessions;
  g public.gyms;
  v_booked integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if not exists (select 1 from public.gym_staff where gym_id = s.gym_id and user_id = auth.uid()) then
    raise exception 'not_staff';
  end if;
  if s.cancelled then raise exception 'session_cancelled'; end if;
  if p_new_start <= now() then raise exception 'time_in_past'; end if;
  select * into g from public.gyms where id = s.gym_id;

  select count(*) into v_booked from public.bookings where session_id = s.id and status = 'confirmed';

  update public.class_sessions
  set starts_at = p_new_start,
      local_date = (p_new_start at time zone g.timezone)::date,
      time_changed = time_changed or v_booked > 0
  where id = s.id;

  insert into public.email_outbox (template, recipient, data)
  select 'class_time_changed', p.email,
         jsonb_build_object('gymName', g.name, 'className', s.name, 'startsAt', s.starts_at,
                            'newStartsAt', p_new_start, 'timezone', g.timezone)
  from public.bookings b
  join public.profiles p on p.id = b.member_id
  where b.session_id = s.id and b.status = 'confirmed' and p.email is not null;
end $$;

-- Owner-facing: spots taken on one of the caller's own dates, using the one shared counting rule.
create function public.session_spots_taken(p_session_id uuid) returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_gym uuid;
begin
  select gym_id into v_gym from public.class_sessions where id = p_session_id;
  if v_gym is null or not exists (select 1 from public.gym_staff where gym_id = v_gym and user_id = auth.uid()) then
    raise exception 'not_staff';
  end if;
  return public.spots_taken(p_session_id);
end $$;

-- Per-minute tidy now also keeps every series' window of dates filled. Later work extends this function.
create or replace function public.tidy() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._generate_all_sessions();
end $$;

revoke execute on function public.check_coach_gym() from public, anon, authenticated;
revoke execute on function public.mark_session_edited() from public, anon, authenticated;
revoke execute on function public._generate_series_sessions(uuid, integer) from public, anon, authenticated;
revoke execute on function public._generate_all_sessions() from public, anon, authenticated;
revoke execute on function public.generate_my_series_sessions(uuid) from public, anon;
revoke execute on function public.update_series(uuid, text, text, text, uuid, smallint[], time, integer, integer, integer, integer) from public, anon;
revoke execute on function public.change_session_time(uuid, timestamptz) from public, anon;
revoke execute on function public.session_spots_taken(uuid) from public, anon;
grant execute on function public.session_spots_taken(uuid) to authenticated;
grant execute on function public.generate_my_series_sessions(uuid) to authenticated;
grant execute on function public.update_series(uuid, text, text, text, uuid, smallint[], time, integer, integer, integer, integer) to authenticated;
grant execute on function public.change_session_time(uuid, timestamptz) to authenticated;
grant execute on function public._generate_series_sessions(uuid, integer), public._generate_all_sessions() to service_role;

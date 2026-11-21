-- Waitlist: join, leave, and ordered offers that hold a freed spot for one member at a time.
-- Every path that frees a spot ends up in offer_next, inside the transaction that freed it, with the session locked.

-- Offers freed spots in the order members joined. A spot is held for 2 hours, cut short to end 30 minutes before
-- the class. When that leaves less than 15 minutes, nobody is offered it and the spot opens to everyone.
-- Entries whose offer ran out leave the waitlist.
create function public.offer_next(p_session_id uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.class_sessions;
  g public.gyms;
  e public.waitlist_entries;
  prof public.profiles;
  v_end timestamptz;
  v_made integer := 0;
begin
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found or s.cancelled or s.starts_at <= now() then return 0; end if;
  select * into g from public.gyms where id = s.gym_id;

  delete from public.waitlist_entries w using public.waitlist_offers o
  where o.entry_id = w.id and w.session_id = s.id and o.offer_end <= now();

  loop
    exit when public.spots_taken(s.id) >= s.spot_limit;
    select * into e from public.waitlist_entries w
    where w.session_id = s.id and not exists (select 1 from public.waitlist_offers o where o.entry_id = w.id)
    order by w.created_at, w.id limit 1;
    exit when not found;

    v_end := least(now() + interval '2 hours', s.starts_at - interval '30 minutes');
    exit when v_end < now() + interval '15 minutes';

    insert into public.waitlist_offers (entry_id, gym_id, session_id, member_id, offer_end)
    values (e.id, e.gym_id, s.id, e.member_id, v_end);

    select * into prof from public.profiles where id = e.member_id;
    if prof.email is not null then
      insert into public.email_outbox (template, recipient, data)
      values ('waitlist_offer', prof.email,
              jsonb_build_object('gymName', g.name, 'className', s.name, 'startsAt', s.starts_at, 'timezone', g.timezone,
                                 'offerEnd', v_end, 'classPath', '/g/' || g.slug || '/classes/' || s.id::text));
    end if;
    v_made := v_made + 1;
  end loop;
  return v_made;
end $$;

-- A booking that stops holding a spot passes it to the waitlist.
create function public.bookings_free_spot() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.offer_next(new.session_id);
  return new;
end $$;

create trigger bookings_free_spot after update of status on public.bookings
  for each row
  when (old.status in ('pending', 'confirmed') and new.status not in ('pending', 'confirmed'))
  execute function public.bookings_free_spot();

-- Member-facing: join the waitlist of a full class.
create function public.join_waitlist(p_session_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if s.cancelled then raise exception 'session_cancelled'; end if;
  if s.starts_at <= now() then raise exception 'session_started'; end if;
  if s.starts_at > now() + interval '14 days' then raise exception 'outside_window'; end if;
  if exists (select 1 from public.bookings where session_id = s.id and member_id = v_uid and status in ('pending', 'confirmed')) then
    raise exception 'already_booked';
  end if;
  if exists (select 1 from public.waitlist_entries where session_id = s.id and member_id = v_uid) then
    raise exception 'already_waitlisted';
  end if;
  if public.spots_taken(s.id) < s.spot_limit then raise exception 'not_full'; end if;
  insert into public.waitlist_entries (gym_id, session_id, member_id) values (s.gym_id, s.id, v_uid);
end $$;

-- Member-facing: leave the waitlist. A live offer held by the member passes to the next person at once.
create function public.leave_waitlist(p_session_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  perform 1 from public.class_sessions where id = p_session_id for update;
  delete from public.waitlist_entries where session_id = p_session_id and member_id = auth.uid();
  perform public.offer_next(p_session_id);
end $$;

-- take_spot also hands a spot whose hold ran out to the waitlist before counting, so nobody else can take it first.
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

  perform public.offer_next(s.id);

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

-- Raising the limit frees spots, so the waitlist is offered them.
create or replace function public.set_spot_limit(p_session_id uuid, p_limit integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.class_sessions;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if not exists (select 1 from public.gym_staff where gym_id = s.gym_id and user_id = auth.uid()) then
    raise exception 'not_staff';
  end if;
  if p_limit is null or p_limit < 1 then raise exception 'invalid_limit'; end if;
  if p_limit < public.spots_taken(s.id) then raise exception 'limit_below_taken'; end if;
  update public.class_sessions set spot_limit = p_limit where id = s.id;
  perform public.offer_next(s.id);
end $$;

-- Locks the session before the booking, like every other path.
create or replace function public.release_booking(p_booking_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_session uuid;
begin
  select session_id into v_session from public.bookings where id = p_booking_id;
  if v_session is null then return; end if;
  perform 1 from public.class_sessions where id = v_session for update;
  update public.bookings set status = 'failed' where id = p_booking_id and status = 'pending';
end $$;

-- Per-minute tidy: keep series dates filled, release holds past their grace (session locked first), and hand freed
-- or lapsed spots to the waitlist.
create or replace function public.tidy() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  perform public._generate_all_sessions();

  for r in
    select distinct session_id from public.bookings
    where status = 'pending' and hold_expires_at + interval '3 minutes' <= now()
    order by session_id
  loop
    perform 1 from public.class_sessions where id = r.session_id for update;
    update public.bookings set status = 'expired'
    where session_id = r.session_id and status = 'pending' and hold_expires_at + interval '3 minutes' <= now();
  end loop;

  for r in select distinct session_id from public.waitlist_entries order by session_id loop
    perform public.offer_next(r.session_id);
  end loop;
end $$;

revoke execute on function public.offer_next(uuid) from public, anon, authenticated;
revoke execute on function public.bookings_free_spot() from public, anon, authenticated;
revoke execute on function public.join_waitlist(uuid) from public, anon;
revoke execute on function public.leave_waitlist(uuid) from public, anon;
grant execute on function public.join_waitlist(uuid), public.leave_waitlist(uuid) to authenticated;
grant execute on function public.offer_next(uuid) to service_role;

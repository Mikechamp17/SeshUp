-- Capacity and booking functions. One function owns the count, and every path locks the session row first.

create function public.is_gym_staff(p_gym uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.gym_staff where gym_id = p_gym and user_id = auth.uid())
$$;

create function public.is_operator() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Spots taken = confirmed bookings, pending holds (until 3 minutes after they expire), and live waitlist offers
-- whose holder has no live booking on the session (the booking replaces the offer, so the spot counts once).
create function public.spots_taken(p_session uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select (
    select count(*) from public.bookings b
    where b.session_id = p_session
      and (b.status = 'confirmed' or (b.status = 'pending' and b.hold_expires_at + interval '3 minutes' > now()))
  )::integer + (
    select count(*) from public.waitlist_offers o
    where o.session_id = p_session
      and o.offer_end > now()
      and not exists (
        select 1 from public.bookings b
        where b.session_id = p_session and b.member_id = o.member_id
          and (b.status = 'confirmed' or (b.status = 'pending' and b.hold_expires_at + interval '3 minutes' > now()))
      )
  )::integer
$$;

-- The caller is always auth.uid(). Locks the session row, then counts, then inserts a 10-minute pending hold.
create function public.take_spot(p_session_id uuid)
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

  -- Holds past their 3-minute grace are released here, and the caller's own expired hold is replaced.
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

  insert into public.bookings (gym_id, session_id, member_id, status, hold_expires_at)
  values (s.gym_id, s.id, v_uid, 'pending', v_hold)
  returning id into v_booking;

  return query select v_booking, 'booked'::text, s.price_cents, g.fee_bps;
end $$;

-- Owner-facing: takes only a session id and checks staff against the locked session's own gym.
create function public.set_spot_limit(p_session_id uuid, p_limit integer) returns void
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
end $$;

-- The only anonymous read: public fields of a gym's upcoming classes, with spots left.
create function public.public_timetable(p_gym_slug text, p_from timestamptz, p_to timestamptz)
returns table (
  session_id uuid, starts_at timestamptz, length_minutes integer, name text, description text, level text,
  coach_name text, price_cents integer, spots_left integer, bookable boolean, gym_name text, timezone text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_to - p_from > interval '21 days' then raise exception 'range_too_long'; end if;
  return query
  select s.id, s.starts_at, s.length_minutes, s.name, s.description, s.level, c.name, s.price_cents,
         greatest(s.spot_limit - public.spots_taken(s.id), 0), (g.paystack_subaccount_code is not null), g.name, g.timezone
  from public.gyms g
  join public.class_sessions s on s.gym_id = g.id
  left join public.coaches c on c.id = s.coach_id
  where g.slug = p_gym_slug and not s.cancelled and s.starts_at > now()
    and s.starts_at >= p_from and s.starts_at < p_to
  order by s.starts_at;
end $$;

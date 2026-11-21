-- Row-level security, grants, and function execute rights.
-- Staff write only coaches, class series, and a few class_sessions columns. Money tables, booking status, and gym
-- payment columns are written only by service-role code or the definer functions.

alter table public.gyms enable row level security;
alter table public.platform_admins enable row level security;
alter table public.profiles enable row level security;
alter table public.gym_staff enable row level security;
alter table public.coaches enable row level security;
alter table public.class_series enable row level security;
alter table public.class_sessions enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.refunds enable row level security;
alter table public.gym_ledger_entries enable row level security;
alter table public.email_outbox enable row level security;
alter table public.waitlist_entries enable row level security;
alter table public.waitlist_offers enable row level security;

-- Table privileges: start from nothing, then grant exactly what each role needs.
revoke all on all tables in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;

grant select on public.gyms, public.gym_staff, public.platform_admins, public.profiles, public.coaches,
  public.class_series, public.class_sessions, public.bookings, public.waitlist_entries, public.waitlist_offers
  to authenticated;
grant insert on public.coaches, public.class_series to authenticated;
grant update (name) on public.coaches to authenticated;
grant update on public.class_series to authenticated;
grant update (name) on public.profiles to authenticated;
grant update (price_cents, cutoff_hours, coach_id, level, name, description) on public.class_sessions to authenticated;

-- Policies
create policy gyms_read on public.gyms for select to authenticated
  using (public.is_gym_staff(id) or public.is_operator()
    or exists (select 1 from public.bookings b where b.gym_id = gyms.id and b.member_id = auth.uid()));

create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());
create policy gym_staff_self on public.gym_staff for select to authenticated using (user_id = auth.uid());

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid()
    or exists (select 1 from public.bookings b where b.member_id = profiles.id and public.is_gym_staff(b.gym_id))
    or exists (select 1 from public.waitlist_entries w where w.member_id = profiles.id and public.is_gym_staff(w.gym_id)));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy coaches_read on public.coaches for select to authenticated using (public.is_gym_staff(gym_id));
create policy coaches_insert on public.coaches for insert to authenticated with check (public.is_gym_staff(gym_id));
create policy coaches_update on public.coaches for update to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));

create policy series_read on public.class_series for select to authenticated using (public.is_gym_staff(gym_id));
create policy series_insert on public.class_series for insert to authenticated with check (public.is_gym_staff(gym_id));
create policy series_update on public.class_series for update to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));

create policy sessions_read on public.class_sessions for select to authenticated
  using (public.is_gym_staff(gym_id)
    or exists (select 1 from public.bookings b where b.session_id = class_sessions.id and b.member_id = auth.uid())
    or exists (select 1 from public.waitlist_entries w where w.session_id = class_sessions.id and w.member_id = auth.uid()));
create policy sessions_update on public.class_sessions for update to authenticated
  using (public.is_gym_staff(gym_id)) with check (public.is_gym_staff(gym_id));

create policy bookings_read on public.bookings for select to authenticated
  using (member_id = auth.uid() or public.is_gym_staff(gym_id));
create policy waitlist_entries_read on public.waitlist_entries for select to authenticated
  using (member_id = auth.uid() or public.is_gym_staff(gym_id));
create policy waitlist_offers_read on public.waitlist_offers for select to authenticated
  using (member_id = auth.uid() or public.is_gym_staff(gym_id));

-- Function execute rights: nothing by default. Member-facing and owner-facing functions derive the caller from auth.uid().
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.take_spot(uuid) to authenticated;
grant execute on function public.set_spot_limit(uuid, integer) to authenticated;
grant execute on function public.public_timetable(text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.is_gym_staff(uuid) to authenticated;
grant execute on function public.is_operator() to authenticated;
grant execute on all functions in schema public to service_role;

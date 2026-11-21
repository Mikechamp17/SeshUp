-- Indexes for the per-minute hold expiry and the daily data purge, and a tidy that skips waitlists of dates
-- that are cancelled or already started.

create index bookings_pending_hold_idx on public.bookings (hold_expires_at) where status = 'pending';
create index payment_events_payload_idx on public.payment_events (created_at) where payload is not null;
create index email_outbox_body_idx on public.email_outbox (created_at) where data <> '{}'::jsonb;

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

  for r in
    select distinct w.session_id from public.waitlist_entries w
    join public.class_sessions s on s.id = w.session_id
    where s.starts_at > now() and not s.cancelled
    order by w.session_id
  loop
    perform public.offer_next(r.session_id);
  end loop;
end $$;

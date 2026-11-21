-- Email outbox claiming, data retention, member erasure, and the per-minute tidy hook.
-- All of these are executable by service_role only.

-- Claim due, unsent emails. Each claimed row is leased for 5 minutes so two parallel runs never send the same row.
-- A row is retried until it has failed 8 times.
create function public.claim_due_emails(p_limit integer)
returns setof public.email_outbox
language sql security definer set search_path = public, pg_temp as $$
  with due as (
    select id from public.email_outbox
    where sent_at is null and attempts < 8 and next_attempt_at <= now()
    order by next_attempt_at, created_at
    limit p_limit
    for update skip locked
  )
  update public.email_outbox o
  set next_attempt_at = now() + interval '5 minutes'
  from due
  where o.id = due.id
  returning o.*
$$;

create function public.mark_email_sent(p_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.email_outbox set sent_at = now(), last_error = null where id = p_id
$$;

-- Failure: count the attempt and back off 2^attempts minutes, capped at an hour.
create function public.mark_email_failed(p_id uuid, p_error text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.email_outbox
  set attempts = attempts + 1,
      last_error = left(p_error, 500),
      next_attempt_at = now() + least(power(2, attempts + 1) * interval '1 minute', interval '1 hour')
  where id = p_id
$$;

-- Raw webhook payloads and outbox bodies are kept for 90 days.
create function public.purge_old_data() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.payment_events set payload = null
  where payload is not null and created_at < now() - interval '90 days';
  update public.email_outbox set data = '{}'::jsonb
  where data <> '{}'::jsonb and created_at < now() - interval '90 days';
end $$;

-- Erasing a member keeps their bookings and payments and removes who they were.
create function public.erase_member(p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles
  set name = 'Erased member', email = null, erased_at = now()
  where id = p_member;
  update auth.users
  set email = 'erased-' || p_member::text || '@erased.invalid', raw_user_meta_data = '{}'::jsonb
  where id = p_member;
end $$;

-- Runs every minute from pg_cron. Later work adds hold expiry, waitlist offers, and session generation here.
create function public.tidy() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  null;
end $$;

-- Calls the Next.js job route with the shared secret from Supabase Vault. Does nothing where pg_net or Vault is absent.
create function public.call_job_route() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_url text;
  v_secret text;
begin
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'job_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'job_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-job-secret', v_secret),
    body := '{}'::jsonb
  );
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.take_spot(uuid) to authenticated;
grant execute on function public.set_spot_limit(uuid, integer) to authenticated;
grant execute on function public.public_timetable(text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.is_gym_staff(uuid) to authenticated;
grant execute on function public.is_operator() to authenticated;
grant execute on all functions in schema public to service_role;

-- Schedule the one-minute job where pg_cron exists (Supabase). Skipped on plain Postgres.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('seshup-minute', '* * * * *', 'select public.tidy(); select public.call_job_route();');
  end if;
end $$;

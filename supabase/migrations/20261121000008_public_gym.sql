-- Public gym lookup, so an unknown link can be told apart from a gym with no classes yet.
-- Returns the gym's name and time zone only.
create function public.public_gym(p_slug text) returns table (name text, timezone text)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.name, g.timezone from public.gyms g where g.slug = p_slug
$$;

revoke execute on function public.public_gym(text) from public;
grant execute on function public.public_gym(text) to anon, authenticated, service_role;

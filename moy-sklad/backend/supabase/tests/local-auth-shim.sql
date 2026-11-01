-- LOCAL TESTS ONLY. Minimal stand-in for what Supabase already provides (auth schema, auth.users,
-- auth.uid(), roles anon/authenticated) so migrations can be tested on plain PostgreSQL.
-- Never apply this file to a Supabase project.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

-- Same resolution order as Supabase's auth.uid().
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end
$$;

grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;

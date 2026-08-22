-- Chapter 3-3 fixture additions after the 3-1 + 3-2 fixtures.
-- Plain PostgreSQL does not provide Supabase auth.uid() or the production profiles table.

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

create table public.profiles (
  id uuid primary key,
  nickname text not null default 'fixture',
  role text not null default 'user',
  status text not null default 'active'
);

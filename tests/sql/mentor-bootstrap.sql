-- Isolated PostgreSQL fixture for mentor-dashboard migration tests.
-- Contains synthetic users only; never connects to Supabase production.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;

create table auth.users (
  id uuid primary key
);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table public.student_profiles (
  user_id uuid primary key references auth.users(id),
  username text not null,
  display_name text not null
);

create table public.learning_progress (
  user_id uuid primary key references auth.users(id),
  progress jsonb not null default '{}'::jsonb
);

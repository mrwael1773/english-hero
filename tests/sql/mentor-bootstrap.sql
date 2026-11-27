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

-- Synthetic supervisor fixtures for role-based exclusion tests.
insert into auth.users (id) values
  ('a1111111-1111-4111-8111-111111111111'),
  ('a2222222-2222-4222-8222-222222222222'),
  ('a3333333-3333-4333-8333-333333333333'),
  ('a4444444-4444-4444-8444-444444444444'),
  ('b5555555-5555-4555-8555-555555555555');

insert into public.student_profiles (user_id, username, display_name) values
  ('a1111111-1111-4111-8111-111111111111', '1013506835', 'أبو باسل'),
  ('a2222222-2222-4222-8222-222222222222', 'wael_2009', 'وائل صامد'),
  ('a3333333-3333-4333-8333-333333333333', 'mahmud', 'محمود'),
  ('a4444444-4444-4444-8444-444444444444', 'iii', 'مشعل'),
  ('b5555555-5555-4555-8555-555555555555', 'future-mahmud-student', 'محمود');

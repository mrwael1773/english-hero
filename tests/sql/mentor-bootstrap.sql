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

-- Model the shared test project's existing but fail-closed teacher-pilot table.
-- Its historical CHECK constraints and updated_at trigger are intentionally absent.
create table public.teacher_pilot_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  pre_score smallint not null,
  post_score smallint not null,
  retention_score smallint,
  sessions_attended smallint not null default 0,
  learning_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  session_log jsonb not null default '[]'::jsonb
);
alter table public.teacher_pilot_results enable row level security;
alter table public.teacher_pilot_results force row level security;
revoke all privileges on table public.teacher_pilot_results from public, anon, authenticated;

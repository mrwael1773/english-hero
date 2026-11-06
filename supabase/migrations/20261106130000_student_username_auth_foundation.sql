-- Username-based student sign-in foundation.
-- No existing auth users or learning progress are modified or deleted.
-- Passwords remain exclusively in Supabase Auth.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists public.student_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_profiles_username_format
    check (username = lower(username) and username ~ '^[a-z0-9_]{3,24}$'),
  constraint student_profiles_display_name_length
    check (char_length(display_name) between 1 and 48)
);

create unique index if not exists student_profiles_username_unique
  on public.student_profiles (username);

alter table public.student_profiles enable row level security;
alter table public.student_profiles force row level security;
revoke all on public.student_profiles from public, anon, authenticated;
grant select, insert, update on public.student_profiles to authenticated;

drop policy if exists "Students can read own profile" on public.student_profiles;
create policy "Students can read own profile"
  on public.student_profiles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Students can create own profile" on public.student_profiles;
create policy "Students can create own profile"
  on public.student_profiles for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Students can update own profile" on public.student_profiles;
create policy "Students can update own profile"
  on public.student_profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Private mapping used only by the username-login Edge Function.
create table if not exists private.student_login_lookup (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  email text not null unique
);
revoke all on private.student_login_lookup from public, anon, authenticated, service_role;
grant select, insert, update, delete on private.student_login_lookup to service_role;

-- The browser can claim a username only for its currently authenticated user.
create or replace function public.claim_student_username(
  p_username text,
  p_display_name text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_display_name text := trim(coalesce(p_display_name, ''));
  v_email text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Invalid username' using errcode = '22023';
  end if;
  if char_length(v_display_name) not between 1 and 48 then
    raise exception 'Invalid display name' using errcode = '22023';
  end if;

  select email into v_email
  from auth.users
  where id = v_user_id and email_confirmed_at is not null;

  if v_email is null then
    raise exception 'A verified email is required' using errcode = '42501';
  end if;

  insert into public.student_profiles(user_id, username, display_name)
  values (v_user_id, v_username, v_display_name)
  on conflict (user_id) do update
    set username = excluded.username,
        display_name = excluded.display_name,
        updated_at = now();

  insert into private.student_login_lookup(user_id, username, email)
  values (v_user_id, v_username, v_email)
  on conflict (user_id) do update
    set username = excluded.username,
        email = excluded.email;

  return jsonb_build_object('username', v_username, 'display_name', v_display_name);
end;
$$;

revoke all on function public.claim_student_username(text, text) from public, anon;
grant execute on function public.claim_student_username(text, text) to authenticated;

-- Atomic per-username + per-IP rate limiting. Only a SHA-256 key is stored.
create table if not exists private.student_login_attempts (
  attempt_key text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 0
);
revoke all on private.student_login_attempts from public, anon, authenticated, service_role;
grant select, insert, update, delete on private.student_login_attempts to service_role;

create or replace function private.consume_student_login_attempt(p_attempt_key text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
declare
  v_attempts integer;
begin
  if p_attempt_key !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  insert into private.student_login_attempts(attempt_key, window_started_at, attempts)
  values (p_attempt_key, now(), 1)
  on conflict (attempt_key) do update
    set attempts = case
      when private.student_login_attempts.window_started_at < now() - interval '15 minutes' then 1
      else private.student_login_attempts.attempts + 1
    end,
    window_started_at = case
      when private.student_login_attempts.window_started_at < now() - interval '15 minutes' then now()
      else private.student_login_attempts.window_started_at
    end
  returning attempts into v_attempts;

  return v_attempts <= 5;
end;
$$;

create or replace function private.resolve_student_login_email(p_username text)
returns text
language sql
security definer
set search_path = pg_catalog, private
as $$
  select email
  from private.student_login_lookup
  where username = lower(trim(coalesce(p_username, '')))
  limit 1;
$$;

revoke all on function private.consume_student_login_attempt(text) from public, anon, authenticated;
revoke all on function private.resolve_student_login_email(text) from public, anon, authenticated;
grant execute on function private.consume_student_login_attempt(text) to service_role;
grant execute on function private.resolve_student_login_email(text) to service_role;

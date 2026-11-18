-- Student activity tracking and mentor-only read access.
-- This migration is intentionally additive: it does not alter existing student progress.
create table if not exists public.student_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.student_activity enable row level security;
revoke all on public.student_activity from anon, authenticated;

create table if not exists public.student_access_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('mentor')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.student_access_roles enable row level security;
revoke all on public.student_access_roles from anon, authenticated;

create or replace function public.record_student_activity()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_last_seen timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  insert into public.student_activity(user_id, last_seen_at)
  values (v_user_id, now())
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at
    where public.student_activity.last_seen_at < now() - interval '5 minutes'
  returning last_seen_at into v_last_seen;

  if v_last_seen is null then
    select a.last_seen_at into v_last_seen
    from public.student_activity as a
    where a.user_id = v_user_id;
  end if;
  return v_last_seen;
end;
$$;
revoke all on function public.record_student_activity() from public, anon;
grant execute on function public.record_student_activity() to authenticated;

create or replace function public.get_mentor_student_overview()
returns table (
  user_id uuid,
  username text,
  display_name text,
  last_seen_at timestamptz,
  progress_updated_at timestamptz,
  progress jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.student_access_roles as r
    where r.user_id = auth.uid() and r.role = 'mentor'
  ) then
    raise exception 'Mentor access required' using errcode = '42501';
  end if;

  return query
    select p.user_id, p.username, p.display_name,
           a.last_seen_at, lp.updated_at,
           jsonb_build_object(
             'xp', lp.progress->'xp',
             'completed', lp.progress->'completed',
             'masteredLessons', lp.progress->'masteredLessons',
             'quizzes', lp.progress->'quizzes',
             'level', lp.progress->'level'
           )
    from public.student_profiles as p
    left join public.student_activity as a on a.user_id = p.user_id
    left join public.learning_progress as lp on lp.user_id = p.user_id
    order by p.display_name, p.username;
end;
$$;
revoke all on function public.get_mentor_student_overview() from public, anon;
grant execute on function public.get_mentor_student_overview() to authenticated;

comment on table public.student_activity is
  'Minimal per-account last-seen timestamp; no IP address or device fingerprint is stored.';
comment on table public.student_access_roles is
  'Privileged application roles; assignments must be provisioned by a trusted database administrator.';

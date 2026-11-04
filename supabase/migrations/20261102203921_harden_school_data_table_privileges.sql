-- Keep school data tables closed to browser roles unless explicit owner policies exist.
-- Version matches the connected Supabase migration history (20261102203921).
-- student_progress is a legacy table present in the connected project but has no
-- CREATE TABLE migration in the repository history; guard it so clean installs do not fail.
do $$
begin
  if to_regclass('public.student_progress') is not null then
    alter table public.student_progress enable row level security;
    alter table public.student_progress force row level security;
    revoke all on table public.student_progress from anon, authenticated;
  end if;
end
$$;

-- analytics_events is created by migration 20261026120515 and intentionally has
-- no client-facing policies or grants.
alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;
revoke all on table public.analytics_events from anon, authenticated;

-- Keep school data tables closed to browser roles unless explicit owner policies exist.
-- Version matches the connected Supabase migration history (20261102203921).
-- These two tables intentionally have no client-facing RLS policies at this time.
alter table public.student_progress enable row level security;
alter table public.student_progress force row level security;
revoke all on table public.student_progress from anon, authenticated;

alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;
revoke all on table public.analytics_events from anon, authenticated;

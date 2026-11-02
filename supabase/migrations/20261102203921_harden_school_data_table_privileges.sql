-- School-readiness hardening: remove broad table privileges that bypass RLS.
-- Preserve existing rows; no student or analytics data is deleted.

-- This legacy table is not referenced by the current application. It is kept
-- for compatibility but receives no direct client access.
do $$
begin
  if to_regclass('public.student_progress') is not null then
    execute 'REVOKE ALL PRIVILEGES ON TABLE public.student_progress FROM PUBLIC, anon, authenticated';
    execute 'DROP POLICY IF EXISTS "Enable insert for users based on user_id" ON public.student_progress';
    execute 'DROP POLICY IF EXISTS "Enable users to view their own data only" ON public.student_progress';
    execute 'DROP POLICY IF EXISTS "update_own_progress" ON public.student_progress';
    execute 'ALTER TABLE public.student_progress FORCE ROW LEVEL SECURITY';
  end if;
end
$$;

-- Rebuild active learner-progress grants from the minimum required set.
REVOKE ALL PRIVILEGES ON TABLE public.learning_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.learning_progress TO authenticated;
ALTER TABLE public.learning_progress FORCE ROW LEVEL SECURITY;

-- The public website no longer sends custom analytics events. Retain old rows,
-- but stop all client access and remove the obsolete public insert policy.
REVOKE ALL PRIVILEGES ON TABLE public.analytics_events FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Public can record limited analytics events" ON public.analytics_events;
ALTER TABLE public.analytics_events FORCE ROW LEVEL SECURITY;

-- School-readiness hardening: remove broad table privileges that bypass RLS.
-- Preserve existing rows; no student or analytics data is deleted.

-- Legacy student_progress may not exist in clean installations.
-- Harden it only when present; do not make the full migration depend on it.
DO $$
BEGIN
  IF to_regclass('public.student_progress') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON TABLE public.student_progress FROM PUBLIC, anon, authenticated;
    DROP POLICY IF EXISTS "Enable insert for users based on user_id" ON public.student_progress;
    DROP POLICY IF EXISTS "Enable users to view their own data only" ON public.student_progress;
    DROP POLICY IF EXISTS "update_own_progress" ON public.student_progress;
    ALTER TABLE public.student_progress FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;

-- Rebuild the active learner-progress grants from the minimum required set.
-- TRUNCATE, REFERENCES, and TRIGGER are not needed by the browser client.
REVOKE ALL PRIVILEGES ON TABLE public.learning_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.learning_progress TO authenticated;
ALTER TABLE public.learning_progress FORCE ROW LEVEL SECURITY;

-- The public website no longer sends custom analytics events. Stop anonymous
-- and authenticated inserts while retaining historical rows for now.
DO $$
BEGIN
  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    REVOKE ALL PRIVILEGES ON TABLE public.analytics_events FROM PUBLIC, anon, authenticated;
    DROP POLICY IF EXISTS "Public can record limited analytics events" ON public.analytics_events;
    ALTER TABLE public.analytics_events FORCE ROW LEVEL SECURITY;
  END IF;
END
$$;

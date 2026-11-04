-- School-readiness hardening: remove broad table privileges that bypass RLS.
-- Preserve existing rows; no student or analytics data is deleted.

-- This legacy table is not referenced by the current application.
-- Remove all client access until a separately reviewed migration is needed.
REVOKE ALL PRIVILEGES ON TABLE public.student_progress FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Enable insert for users based on user_id" ON public.student_progress;
DROP POLICY IF EXISTS "Enable users to view their own data only" ON public.student_progress;
DROP POLICY IF EXISTS "update_own_progress" ON public.student_progress;
ALTER TABLE public.student_progress FORCE ROW LEVEL SECURITY;

-- Rebuild the active learner-progress grants from the minimum required set.
-- TRUNCATE, REFERENCES, and TRIGGER are not needed by the browser client.
REVOKE ALL PRIVILEGES ON TABLE public.learning_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.learning_progress TO authenticated;
ALTER TABLE public.learning_progress FORCE ROW LEVEL SECURITY;

-- The public website no longer sends custom analytics events. Stop anonymous
-- and authenticated inserts while retaining historical rows for now.
REVOKE ALL PRIVILEGES ON TABLE public.analytics_events FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Public can record limited analytics events" ON public.analytics_events;
ALTER TABLE public.analytics_events FORCE ROW LEVEL SECURITY;

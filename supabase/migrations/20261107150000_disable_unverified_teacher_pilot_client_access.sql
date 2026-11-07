-- Fail closed: this table is not a teacher authorization system.
-- Until a separately reviewed server-side teacher role and provisioning flow exist,
-- browser-authenticated users must not create or alter pilot result records.
-- Existing rows are preserved; the public demo continues to use tab-local synthetic data.

ALTER TABLE public.teacher_pilot_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers read their own pilot results" ON public.teacher_pilot_results;
DROP POLICY IF EXISTS "Teachers insert their own pilot results" ON public.teacher_pilot_results;
DROP POLICY IF EXISTS "Teachers update their own pilot results" ON public.teacher_pilot_results;
DROP POLICY IF EXISTS "Teachers delete their own pilot results" ON public.teacher_pilot_results;

REVOKE ALL PRIVILEGES ON TABLE public.teacher_pilot_results
  FROM PUBLIC, anon, authenticated;

-- No authenticated client grant is intentionally present.
-- A future teacher workflow must use a server-side authorization boundary
-- and receive its own reviewed migration; do not restore owner-only client CRUD.

-- Keep the database event-trigger helper private to database administration.
-- Some installations do not define this optional helper; in that case there is
-- nothing to revoke. If present, remove API-role execution explicitly.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END
$$;

-- Cache auth.uid() per statement rather than reevaluating it for every row.
DROP POLICY IF EXISTS "Learners can insert their own progress" ON public.learning_progress;
CREATE POLICY "Learners can insert their own progress"
  ON public.learning_progress FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Learners can read their own progress" ON public.learning_progress;
CREATE POLICY "Learners can read their own progress"
  ON public.learning_progress FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Learners can update their own progress" ON public.learning_progress;
CREATE POLICY "Learners can update their own progress"
  ON public.learning_progress FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Keep the database event-trigger helper private to database administration.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

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
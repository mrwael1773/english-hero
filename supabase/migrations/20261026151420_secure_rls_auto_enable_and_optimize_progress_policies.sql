-- Applied to the English Hero Supabase project on 2026-10-26.
-- Restrict the event-trigger helper to database administration.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- Keep the learner's row isolated while avoiding repeated auth.uid() evaluation.
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

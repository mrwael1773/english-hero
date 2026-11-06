-- Evaluate auth.uid() once per statement instead of once per candidate row.
-- This preserves the owner-only RLS semantics while avoiding repeated initplan work.

drop policy if exists "Students can read own profile" on public.student_profiles;
create policy "Students can read own profile"
  on public.student_profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Students can manage own learning progress" on public.learning_progress;
create policy "Students can manage own learning progress"
  on public.learning_progress
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

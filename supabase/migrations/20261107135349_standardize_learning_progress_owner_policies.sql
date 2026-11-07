-- Standardize learning_progress ownership policies across test and production.
-- Keep explicit SELECT/INSERT/UPDATE policies and avoid a broad ALL policy.
drop policy if exists "Students can manage own learning progress" on public.learning_progress;
drop policy if exists "Learners can insert their own progress" on public.learning_progress;
drop policy if exists "Learners can read their own progress" on public.learning_progress;
drop policy if exists "Learners can update their own progress" on public.learning_progress;

create policy "Learners can insert their own progress"
  on public.learning_progress
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Learners can read their own progress"
  on public.learning_progress
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Learners can update their own progress"
  on public.learning_progress
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

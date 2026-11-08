-- Production migration-history alignment copy.
-- The same idempotent policy standardization was first applied to the isolated
-- test project as version 20261107135349. Production recorded it as
-- 20261107135603. Keep both versioned files so each environment's history is
-- represented without editing Supabase's migration ledger.
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

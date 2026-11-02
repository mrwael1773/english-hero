-- Reconstructed follow-up migration from the applied migration history.
-- Reassert owner-only policies idempotently for reproducible fresh deployments.
alter table public.learning_progress enable row level security;

drop policy if exists "Learners can read their own progress" on public.learning_progress;
create policy "Learners can read their own progress"
  on public.learning_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Learners can insert their own progress" on public.learning_progress;
create policy "Learners can insert their own progress"
  on public.learning_progress for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Learners can update their own progress" on public.learning_progress;
create policy "Learners can update their own progress"
  on public.learning_progress for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

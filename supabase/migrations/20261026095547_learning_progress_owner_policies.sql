-- Reconstructed from the applied Supabase migration history and live schema.
-- The repository previously omitted this applied migration version.
create table if not exists public.learning_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint learning_progress_object check (jsonb_typeof(progress) = 'object')
);

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.learning_progress'::regclass
      AND conname = 'learning_progress_object'
  ) THEN
    ALTER TABLE public.learning_progress
      ADD CONSTRAINT learning_progress_object
      CHECK (jsonb_typeof(progress) = 'object');
  END IF;
END
$;

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

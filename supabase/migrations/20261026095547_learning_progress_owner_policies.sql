-- English Hero: one durable progress record per authenticated learner.
-- Run in Supabase SQL Editor once. Never expose a service_role key in browser code.
create table if not exists public.learning_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.learning_progress enable row level security;

drop policy if exists "Learners can read their own progress" on public.learning_progress;
create policy "Learners can read their own progress"
  on public.learning_progress for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Learners can insert their own progress" on public.learning_progress;
create policy "Learners can insert their own progress"
  on public.learning_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Learners can update their own progress" on public.learning_progress;
create policy "Learners can update their own progress"
  on public.learning_progress for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.learning_progress to authenticated;

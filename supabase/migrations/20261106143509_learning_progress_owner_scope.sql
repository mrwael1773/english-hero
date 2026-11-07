-- Per-student cloud progress storage.
-- The browser can read and write only the row owned by its authenticated user.
-- No existing learning progress table or rows are modified if the table already exists.

create table if not exists public.learning_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint learning_progress_progress_object
    check (jsonb_typeof(progress) = 'object')
);

alter table public.learning_progress enable row level security;
alter table public.learning_progress force row level security;

revoke all on public.learning_progress from public, anon, authenticated;
grant select, insert, update on public.learning_progress to authenticated;

drop policy if exists "Students can manage own learning progress" on public.learning_progress;
create policy "Students can manage own learning progress"
  on public.learning_progress
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

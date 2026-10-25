-- English Hero cloud progress storage (Supabase)
-- Run this once in Supabase SQL Editor after creating a project.
-- Passwords are handled by Supabase Auth; NEVER store passwords in this table.

create table if not exists public.learning_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint learning_progress_object check (jsonb_typeof(progress) = 'object')
);

alter table public.learning_progress enable row level security;

-- A signed-in user can access only their own row.
drop policy if exists "Users can read own learning progress" on public.learning_progress;
create policy "Users can read own learning progress"
  on public.learning_progress for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own learning progress" on public.learning_progress;
create policy "Users can insert own learning progress"
  on public.learning_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own learning progress" on public.learning_progress;
create policy "Users can update own learning progress"
  on public.learning_progress for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Do not grant anonymous access. Supabase's authenticated role uses the policies above.
grant select, insert, update on public.learning_progress to authenticated;
revoke all on public.learning_progress from anon;

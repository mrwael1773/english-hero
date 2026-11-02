create table if not exists public.teacher_pilot_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null check (code ~ '^P[0-9]{2,3}$'),
  pre_score smallint not null check (pre_score between 0 and 100),
  post_score smallint not null check (post_score between 0 and 100),
  retention_score smallint check (retention_score between 0 and 100),
  sessions_attended smallint not null default 0 check (sessions_attended between 0 and 16),
  learning_note text check (learning_note is null or char_length(learning_note) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, code)
);

alter table public.teacher_pilot_results enable row level security;
revoke all on table public.teacher_pilot_results from anon, authenticated;
grant select, insert, update, delete on table public.teacher_pilot_results to authenticated;

create policy "Teachers read their own pilot results"
on public.teacher_pilot_results for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Teachers insert their own pilot results"
on public.teacher_pilot_results for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Teachers update their own pilot results"
on public.teacher_pilot_results for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Teachers delete their own pilot results"
on public.teacher_pilot_results for delete
to authenticated
using ((select auth.uid()) = user_id);

create index if not exists teacher_pilot_results_user_updated_idx
on public.teacher_pilot_results (user_id, updated_at desc);

alter table public.teacher_pilot_results force row level security;

create or replace function public.set_teacher_pilot_results_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_teacher_pilot_results_updated_at
on public.teacher_pilot_results;

create trigger set_teacher_pilot_results_updated_at
before update on public.teacher_pilot_results
for each row
execute function public.set_teacher_pilot_results_updated_at();

revoke all on function public.set_teacher_pilot_results_updated_at() from public, anon, authenticated;

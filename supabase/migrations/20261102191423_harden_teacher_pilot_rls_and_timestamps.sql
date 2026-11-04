-- Harden teacher pilot row isolation and maintain updated_at automatically.
-- Version matches the connected Supabase migration history (20261102191423).
alter table public.teacher_pilot_results enable row level security;
alter table public.teacher_pilot_results force row level security;

drop policy if exists "Teachers read their own pilot results" on public.teacher_pilot_results;
create policy "Teachers read their own pilot results"
on public.teacher_pilot_results for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Teachers insert their own pilot results" on public.teacher_pilot_results;
create policy "Teachers insert their own pilot results"
on public.teacher_pilot_results for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Teachers update their own pilot results" on public.teacher_pilot_results;
create policy "Teachers update their own pilot results"
on public.teacher_pilot_results for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Teachers delete their own pilot results" on public.teacher_pilot_results;
create policy "Teachers delete their own pilot results"
on public.teacher_pilot_results for delete to authenticated
using ((select auth.uid()) = user_id);

create index if not exists teacher_pilot_results_user_updated_idx
on public.teacher_pilot_results (user_id, updated_at desc);

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

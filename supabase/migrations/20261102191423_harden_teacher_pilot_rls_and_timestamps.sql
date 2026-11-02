-- Reconstructed from the applied Supabase schema and trigger definition.
-- The teacher pilot table is created by the preceding owner-scoped migration.
alter table public.teacher_pilot_results force row level security;

create or replace function public.set_teacher_pilot_results_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

revoke all on function public.set_teacher_pilot_results_updated_at() from public, anon, authenticated;

drop trigger if exists set_teacher_pilot_results_updated_at on public.teacher_pilot_results;
create trigger set_teacher_pilot_results_updated_at
before update on public.teacher_pilot_results
for each row
execute function public.set_teacher_pilot_results_updated_at();

-- Tracks each attended session (1..16) while preserving existing pilot records.
-- This migration version is already present in the connected Supabase migration history;
-- the file is added here so the repository records the same deployed schema change.

alter table public.teacher_pilot_results
  add column if not exists session_log jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.teacher_pilot_results'::regclass
      and conname = 'teacher_pilot_results_session_log_check'
  ) then
    alter table public.teacher_pilot_results
      add constraint teacher_pilot_results_session_log_check
      check (
        jsonb_typeof(session_log) = 'array'
        and jsonb_array_length(session_log) <= 16
      );
  end if;
end
$$;

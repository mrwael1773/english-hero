-- Atomically enforce the per-student champion challenge start limit.
-- The advisory transaction lock serializes starts for the same student.
create or replace function public.start_student_champion_attempt(
  p_user_id uuid,
  p_lesson_index integer,
  p_answer_key jsonb,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_attempt_id uuid;
  v_recent_starts integer;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_user_id is null
     or p_lesson_index is null or p_lesson_index not between 0 and 83
     or p_answer_key is null or jsonb_typeof(p_answer_key) is distinct from 'array'
     or jsonb_array_length(p_answer_key) <> 10
     or p_expires_at is null or p_expires_at <= v_now
     or p_expires_at > v_now + interval '16 minutes' then
    raise exception 'Invalid challenge reservation' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_answer_key) answer(value)
    where jsonb_typeof(value) is distinct from 'number'
       or (value #>> '{}') !~ '^[0-3]$'
  ) then
    raise exception 'Invalid challenge answer key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select count(*)::integer into v_recent_starts
  from public.student_champion_attempts
  where user_id = p_user_id
    and created_at >= v_now - interval '1 hour';

  if v_recent_starts >= 5 then
    raise exception 'Champion challenge rate limit exceeded' using errcode = 'P0001';
  end if;

  insert into public.student_champion_attempts (
    user_id, lesson_index, answer_key, question_count, expires_at
  )
  values (p_user_id, p_lesson_index, p_answer_key, 10, p_expires_at)
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

revoke all on function public.start_student_champion_attempt(uuid, integer, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.start_student_champion_attempt(uuid, integer, jsonb, timestamptz)
  to service_role;

comment on function public.start_student_champion_attempt(uuid, integer, jsonb, timestamptz) is
  'Serializes per-student challenge starts and enforces at most five attempts per rolling hour.';

-- Keep the test database aligned with the hardened service-role checks.
-- Supabase secret API keys may set the effective PostgREST role without the legacy JWT claim.

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
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and current_setting('role', true) is distinct from 'service_role' then
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

create or replace function public.complete_student_champion_attempt(
  p_attempt_id uuid,
  p_user_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.student_champion_attempts%rowtype;
  v_correct integer := 0;
  v_answer integer;
  v_index integer;
  v_passed boolean;
  v_recorded boolean := false;
  v_inserted integer := 0;
  v_now timestamptz := now();
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and current_setting('role', true) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_attempt_id is null or p_user_id is null or p_answers is null or jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'Invalid challenge submission' using errcode = '22023';
  end if;

  select * into v_attempt
  from public.student_champion_attempts
  where id = p_attempt_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Challenge attempt not found' using errcode = '42501';
  end if;
  if v_attempt.submitted_at is not null then
    raise exception 'Challenge attempt already submitted' using errcode = '22023';
  end if;
  if v_attempt.expires_at <= v_now then
    update public.student_champion_attempts
      set submitted_at = v_now, score = 0
      where id = v_attempt.id;
    return jsonb_build_object('expired', true, 'score', 0, 'total', v_attempt.question_count,
      'passed', false, 'recorded', false);
  end if;
  if jsonb_array_length(p_answers) <> v_attempt.question_count
     or jsonb_array_length(v_attempt.answer_key) <> v_attempt.question_count then
    raise exception 'Invalid answer count' using errcode = '22023';
  end if;

  for v_index in 0..v_attempt.question_count - 1 loop
    if jsonb_typeof(p_answers->v_index) is distinct from 'number'
       or (p_answers->>v_index) !~ '^[0-3]$'
       or jsonb_typeof(v_attempt.answer_key->v_index) is distinct from 'number'
       or (v_attempt.answer_key->>v_index) !~ '^[0-3]$' then
      raise exception 'Invalid answer value' using errcode = '22023';
    end if;
    v_answer := (p_answers->>v_index)::integer;
    if v_answer = (v_attempt.answer_key->>v_index)::integer then
      v_correct := v_correct + 1;
    end if;
  end loop;

  v_passed := v_correct * 100 >= v_attempt.question_count * 80;
  update public.student_champion_attempts
    set submitted_at = v_now, score = v_correct
    where id = v_attempt.id;

  insert into public.student_learning_days(user_id, activity_day, first_activity_at)
  values (p_user_id, (v_now at time zone 'Asia/Riyadh')::date, v_now)
  on conflict (user_id, activity_day) do nothing;

  if v_passed then
    insert into public.student_mastery_events(user_id, lesson_index, mastered_at)
    values (p_user_id, v_attempt.lesson_index, v_now)
    on conflict (user_id, lesson_index) do nothing;
    get diagnostics v_inserted = row_count;
    v_recorded := v_inserted > 0;
  end if;

  insert into public.student_activity (
    user_id, last_seen_at, last_learning_action, last_learning_activity_at,
    last_learning_lesson_index, last_learning_word_index,
    current_lesson_index, current_word_index
  )
  values (
    p_user_id, v_now,
    case when v_passed then 'lesson_mastered' else 'lesson_assessment_attempted' end,
    v_now, v_attempt.lesson_index, null,
    case when v_passed then null else v_attempt.lesson_index end,
    null
  )
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at,
        last_learning_action = excluded.last_learning_action,
        last_learning_activity_at = excluded.last_learning_activity_at,
        last_learning_lesson_index = excluded.last_learning_lesson_index,
        last_learning_word_index = excluded.last_learning_word_index,
        current_lesson_index = case
          when excluded.last_learning_action = 'lesson_mastered' then null
          when excluded.current_lesson_index is not null then excluded.current_lesson_index
          else public.student_activity.current_lesson_index
        end,
        current_word_index = case
          when excluded.last_learning_action = 'lesson_mastered' then null
          when excluded.current_word_index is not null then excluded.current_word_index
          else public.student_activity.current_word_index
        end;

  return jsonb_build_object(
    'expired', false,
    'score', v_correct,
    'total', v_attempt.question_count,
    'passed', v_passed,
    'recorded', v_recorded
  );
end;
$$;

revoke all on function public.complete_student_champion_attempt(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_student_champion_attempt(uuid, uuid, jsonb) to service_role;

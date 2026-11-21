-- Server-verified champion challenges.
-- The public question bank is intentionally empty in migrations: answer keys must be
-- provisioned through a trusted server-side process, never committed to the public repo.
create table if not exists public.student_champion_question_bank (
  id uuid primary key default gen_random_uuid(),
  lesson_index integer not null check (lesson_index between 0 and 83),
  prompt text not null check (length(btrim(prompt)) between 1 and 300),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_option smallint not null check (correct_option between 0 and 3),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists student_champion_question_bank_active_idx
  on public.student_champion_question_bank(lesson_index, active);

create table if not exists public.student_champion_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_index integer not null check (lesson_index between 0 and 83),
  answer_key jsonb not null check (jsonb_typeof(answer_key) = 'array'),
  question_count smallint not null check (question_count = 10),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  score smallint check (score between 0 and 10)
);
create index if not exists student_champion_attempts_owner_created_idx
  on public.student_champion_attempts(user_id, created_at desc);

alter table public.student_champion_question_bank enable row level security;
alter table public.student_champion_question_bank force row level security;
alter table public.student_champion_attempts enable row level security;
alter table public.student_champion_attempts force row level security;
revoke all on table public.student_champion_question_bank from public, anon, authenticated;
revoke all on table public.student_champion_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.student_champion_question_bank to service_role;
grant select, insert, update, delete on table public.student_champion_attempts to service_role;

create or replace function public.record_student_learning_activity(
  p_action text,
  p_lesson_index integer default null,
  p_word_index integer default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_action is null or p_action not in (
    'lesson_started',
    'lesson_progress',
    'lesson_training_completed',
    'lesson_assessment_attempted',
    'lesson_mastered',
    'quiz_completed'
  ) then
    raise exception 'Invalid learning activity' using errcode = '22023';
  end if;
  if p_lesson_index is not null and p_lesson_index not between 0 and 83 then
    raise exception 'Invalid lesson index' using errcode = '22023';
  end if;
  if p_word_index is not null and p_word_index not between 0 and 99 then
    raise exception 'Invalid word index' using errcode = '22023';
  end if;
  if p_action = 'lesson_mastered' then
    raise exception 'Use a server-verified champion challenge to record mastery' using errcode = '42501';
  end if;
  if p_action like 'lesson_%' and p_lesson_index is null then
    raise exception 'Lesson index required' using errcode = '22023';
  end if;

  insert into public.student_activity (
    user_id, last_seen_at, last_learning_action, last_learning_activity_at,
    last_learning_lesson_index, last_learning_word_index,
    current_lesson_index, current_word_index
  )
  values (
    v_user_id, v_now, p_action, v_now, p_lesson_index, p_word_index,
    case when p_action = 'lesson_mastered' then null else p_lesson_index end,
    case when p_action = 'lesson_mastered' then null else p_word_index end
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

  return v_now;
end;
$$;

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
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
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
     or jsonb_array_length(v_attempt.answer_key) <> v_attempt.question_count
     then
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
comment on table public.student_learning_days is
  'One daily participation marker per authenticated student after submitting a server-issued champion challenge; no raw answers or device data.';
comment on table public.student_champion_question_bank is
  'Private server-only question bank. Correct options must never be shipped to browser code or public migrations.';
comment on table public.student_champion_attempts is
  'Private one-use challenge attempts; per-attempt answer keys are accessible only to trusted server code.';
comment on function public.complete_student_champion_attempt(uuid, uuid, jsonb) is
  'Atomically scores a one-use challenge attempt and records mastery only after a server-verified 80 percent pass.';


-- Import the complete question bank atomically through a trusted, one-time RPC.
-- The payload is supplied at runtime and is never stored in the public repository.
create or replace function public.import_student_champion_question_bank(p_questions jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_lesson integer;
  v_correct integer;
  v_prompt text;
  v_option text;
  v_count integer := 0;
  v_existing integer;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_questions is null or jsonb_typeof(p_questions) is distinct from 'array'
     or jsonb_array_length(p_questions) <> 840 then
    raise exception 'The complete 840-question bank is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('english_hero_champion_question_bank_import'));

  select count(*) into v_existing from public.student_champion_question_bank;
  if v_existing <> 0 then
    raise exception 'Question bank is not empty; import is one-time only' using errcode = '55000';
  end if;

  for v_row in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(v_row) is distinct from 'object'
       or jsonb_typeof(v_row->'lesson_index') is distinct from 'number'
       or (v_row->>'lesson_index') !~ '^(0|[1-9][0-9]*)$'
       or jsonb_typeof(v_row->'prompt') is distinct from 'string'
       or jsonb_typeof(v_row->'options') is distinct from 'array'
       or jsonb_array_length(v_row->'options') <> 4
       or jsonb_typeof(v_row->'correct_option') is distinct from 'number'
       or (v_row->>'correct_option') !~ '^[0-3]$' then
      raise exception 'Invalid question structure' using errcode = '22023';
    end if;

    v_lesson := (v_row->>'lesson_index')::integer;
    v_prompt := btrim(v_row->>'prompt');
    v_correct := (v_row->>'correct_option')::integer;
    if v_lesson not between 0 and 83 or length(v_prompt) not between 1 and 300 then
      raise exception 'Invalid lesson index or question prompt' using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_row->'options') as option_value(value)
      where jsonb_typeof(value) is distinct from 'string'
         or length(btrim(value #>> '{}')) not between 1 and 120
    ) then
      raise exception 'Question options must be non-empty strings of at most 120 characters' using errcode = '22023';
    end if;

    if (
      select count(distinct lower(btrim(value #>> '{}')))
      from jsonb_array_elements(v_row->'options') as option_value(value)
    ) <> 4 then
      raise exception 'Question options must be unique' using errcode = '22023';
    end if;

    v_count := v_count + 1;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as question(value)
    group by (value->>'lesson_index')::integer
    having count(*) <> 10
  ) or (
    select count(distinct (value->>'lesson_index')::integer)
    from jsonb_array_elements(p_questions) as question(value)
  ) <> 84 then
    raise exception 'Every lesson must contain exactly 10 questions' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as question(value)
    group by (value->>'lesson_index')::integer, lower(btrim(value->>'prompt'))
    having count(*) > 1
  ) then
    raise exception 'Question prompts must be unique within each lesson' using errcode = '22023';
  end if;

  insert into public.student_champion_question_bank (lesson_index, prompt, options, correct_option, active)
  select
    (value->>'lesson_index')::integer,
    btrim(value->>'prompt'),
    value->'options',
    (value->>'correct_option')::smallint,
    true
  from jsonb_array_elements(p_questions) as question(value);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.import_student_champion_question_bank(jsonb) from public, anon, authenticated;
grant execute on function public.import_student_champion_question_bank(jsonb) to service_role;
comment on function public.import_student_champion_question_bank(jsonb) is
  'One-time atomic import of exactly 840 validated champion questions (10 per lesson) using a private runtime payload and service_role only.';

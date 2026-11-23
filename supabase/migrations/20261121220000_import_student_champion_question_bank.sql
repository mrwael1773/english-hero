-- One-time, atomic import of the private champion question bank.
-- Question text and answer keys are supplied at runtime; no answer data is committed here.
create or replace function public.import_student_champion_question_bank(p_questions jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_lesson_number numeric;
  v_correct_number numeric;
  v_lesson integer;
  v_correct integer;
  v_prompt text;
  v_count integer := 0;
  v_existing integer;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if p_questions is null or jsonb_typeof(p_questions) is distinct from 'array' then
    raise exception 'A JSON question array is required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_questions) <> 840 then
    raise exception 'The complete 840-question bank is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('english_hero_champion_question_bank_import'));

  select count(*) into v_existing
  from public.student_champion_question_bank;
  if v_existing <> 0 then
    raise exception 'Question bank is not empty; import is one-time only' using errcode = '55000';
  end if;

  for v_row in
    select value from jsonb_array_elements(p_questions)
  loop
    if jsonb_typeof(v_row) is distinct from 'object'
       or jsonb_typeof(v_row->'lesson_index') is distinct from 'number'
       or jsonb_typeof(v_row->'prompt') is distinct from 'string'
       or jsonb_typeof(v_row->'options') is distinct from 'array'
       or jsonb_typeof(v_row->'correct_option') is distinct from 'number' then
      raise exception 'Invalid question structure' using errcode = '22023';
    end if;

    v_lesson_number := (v_row->>'lesson_index')::numeric;
    v_correct_number := (v_row->>'correct_option')::numeric;
    if v_lesson_number <> trunc(v_lesson_number)
       or v_lesson_number not between 0 and 83
       or v_correct_number <> trunc(v_correct_number)
       or v_correct_number not between 0 and 3 then
      raise exception 'Invalid lesson index or correct option' using errcode = '22023';
    end if;
    v_lesson := v_lesson_number::integer;
    v_correct := v_correct_number::integer;
    v_prompt := btrim(v_row->>'prompt');

    if length(v_prompt) not between 1 and 300 then
      raise exception 'Question prompt must contain 1 to 300 characters' using errcode = '22023';
    end if;
    if jsonb_array_length(v_row->'options') <> 4 then
      raise exception 'Every question must have exactly four options' using errcode = '22023';
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
    group by (value->>'lesson_index')::numeric
    having count(*) <> 10
  ) or (
    select count(distinct (value->>'lesson_index')::numeric)
    from jsonb_array_elements(p_questions) as question(value)
  ) <> 84 then
    raise exception 'Every lesson must contain exactly 10 questions' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as question(value)
    group by (value->>'lesson_index')::numeric, lower(btrim(value->>'prompt'))
    having count(*) > 1
  ) then
    raise exception 'Question prompts must be unique within each lesson' using errcode = '22023';
  end if;

  insert into public.student_champion_question_bank (
    lesson_index, prompt, options, correct_option, active
  )
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

revoke all on function public.import_student_champion_question_bank(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_student_champion_question_bank(jsonb)
  to service_role;

comment on function public.import_student_champion_question_bank(jsonb) is
  'One-time atomic import of exactly 840 validated champion questions (10 per lesson) using a private runtime payload and service_role only.';

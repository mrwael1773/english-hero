-- PostgreSQL integration assertions for the mentor-dashboard migrations.
-- All identities and progress below are synthetic test fixtures.
\set ON_ERROR_STOP on

insert into auth.users (id)
values ('11111111-1111-4111-8111-111111111111');

insert into public.student_profiles (user_id, username, display_name)
values ('11111111-1111-4111-8111-111111111111', 'synthetic-learner', 'Synthetic Learner');

insert into public.learning_progress (user_id, progress)
values (
  '11111111-1111-4111-8111-111111111111',
  '{"xp":120,"completed":[0,1],"masteredLessons":[0],"lessonStarted":[0,3],"lessonTrained":[0],"lessonPositions":{"3":2}}'::jsonb
);

-- The authenticated student can write only through the constrained functions.
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.record_student_activity();
select public.record_student_learning_activity('lesson_started', 3, 2);

-- Reading completion is isolated by authenticated account and ordered stage ID.
insert into auth.users (id)
values ('22222222-2222-4222-8222-222222222222');

select public.save_my_reading_progress(array['letter-sounds','digraphs']::text[]);

do $reading$
declare
  v_completed text[];
begin
  v_completed := public.get_my_reading_progress();
  if v_completed <> array['letter-sounds','digraphs']::text[] then
    raise exception 'Reading progress did not round-trip for the authenticated student';
  end if;

  perform public.save_my_reading_progress(array['letter-sounds']::text[]);
  if public.get_my_reading_progress() <> array['letter-sounds','digraphs']::text[] then
    raise exception 'Reading progress update unexpectedly regressed completed stages';
  end if;

  begin
    perform public.save_my_reading_progress(array['letter-sounds','blends']::text[]);
    raise exception 'Out-of-order reading stages were accepted';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.save_my_reading_progress(array['unknown-stage']::text[]);
    raise exception 'Unknown reading stage was accepted';
  exception
    when sqlstate '22023' then null;
  end;
end;
$reading$;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $isolation$
begin
  if public.get_my_reading_progress() <> '{}'::text[] then
    raise exception 'Reading progress leaked across student accounts';
  end if;
end;
$isolation$;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

do $$
declare
  v_row public.student_activity%rowtype;
begin
  select * into v_row from public.student_activity
  where user_id = '11111111-1111-4111-8111-111111111111';
  if v_row.last_learning_action <> 'lesson_started'
     or v_row.current_lesson_index <> 3
     or v_row.current_word_index <> 2 then
    raise exception 'Student activity function did not persist the expected latest-only state';
  end if;
end;
$$;

-- Reject unauthenticated writes and invalid learning-event payloads.
do $block$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  begin
    perform public.record_student_activity();
    raise exception 'Unauthenticated activity write was accepted';
  exception
    when sqlstate '42501' then null;
  end;

  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
  begin
    perform public.record_student_learning_activity('unexpected_action', 3, 1);
    raise exception 'Unknown learning action was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.record_student_learning_activity('lesson_progress', 100, 1);
    raise exception 'Out-of-range lesson index was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.record_student_learning_activity('lesson_progress', 3, 100);
    raise exception 'Out-of-range word index was accepted';
  exception
    when sqlstate '22023' then null;
  end;
end;
$block$;

-- A mastered lesson clears the active lesson pointer without deleting the last action.
-- The new mastery-event recorder requires the synced progress snapshot to contain the lesson.
update public.learning_progress
set progress = jsonb_set(progress, '{masteredLessons}', '[0,3]'::jsonb)
where user_id = '11111111-1111-4111-8111-111111111111';
select public.record_student_learning_activity('lesson_mastered', 3, 2);
-- Replaying the same mastery event must not create a second leaderboard entry.
select public.record_student_learning_activity('lesson_mastered', 3, 2);

-- A second synthetic learner has two new masteries this week versus one
-- in the matching elapsed period last week, so improvement is +1.
insert into auth.users (id)
values ('33333333-3333-4333-8333-333333333333');
insert into public.student_profiles (user_id, username, display_name)
values ('33333333-3333-4333-8333-333333333333', 'synthetic-improver', 'Improved Learner');
insert into public.student_mastery_events (user_id, lesson_index, mastered_at)
select '33333333-3333-4333-8333-333333333333', lesson_index,
       (((now() at time zone 'Asia/Riyadh')::date
          - extract(dow from (now() at time zone 'Asia/Riyadh')::date)::integer
          + 1)::timestamp + make_interval(hours => lesson_index)) at time zone 'Asia/Riyadh'
from (values (4),(5)) as lessons(lesson_index);
insert into public.student_mastery_events (user_id, lesson_index, mastered_at)
select '33333333-3333-4333-8333-333333333333', 6,
       (((now() at time zone 'Asia/Riyadh')::date
          - extract(dow from (now() at time zone 'Asia/Riyadh')::date)::integer
          - 6)::timestamp) at time zone 'Asia/Riyadh';

do $champions$
declare
  v_result jsonb;
begin
  if (select count(*) from public.student_mastery_events
      where user_id = '11111111-1111-4111-8111-111111111111' and lesson_index = 3) <> 1 then
    raise exception 'Repeated lesson mastery created duplicate champion events';
  end if;
  if (select count(*) from public.student_learning_days
      where user_id = '11111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'Learning-day tracking did not deduplicate the current Saudi day';
  end if;

  v_result := public.get_student_champions();
  if v_result->>'timezone' <> 'Asia/Riyadh'
     or not exists (
       select 1 from jsonb_array_elements(v_result->'today_leaders') as today_row
       where today_row->>'display_name' = 'Synthetic Learner' and today_row->>'score' = '1'
     )
     or v_result->'week_leaders'->0->>'display_name' <> 'Improved Learner'
     or v_result->'week_leaders'->0->>'score' <> '2'
     or v_result->'mastery_leaders'->0->>'score' <> '2'
     or v_result->'consistency_leaders'->0->>'score' <> '1'
     or v_result->'improvement_leaders'->0->>'display_name' <> 'Improved Learner'
     or v_result->'improvement_leaders'->0->>'score' <> '1' then
    raise exception 'Student champions aggregates were not calculated as expected';
  end if;
  if (v_result::text like '%user_id%' or v_result::text like '%username%' or v_result::text like '%email%') then
    raise exception 'Student champions RPC leaked private identity fields';
  end if;
end;
$champions$;

do $$
begin
  if not exists (
    select 1 from public.student_activity
    where user_id = '11111111-1111-4111-8111-111111111111'
      and last_learning_action = 'lesson_mastered'
      and current_lesson_index is null
      and current_word_index is null
  ) then
    raise exception 'Mastery did not clear the active lesson position';
  end if;
end;
$$;

-- Malformed or out-of-range JSON progress must not break the overview RPC.
update public.learning_progress
set progress = '{
  "xp":999999999999999999999999999,"completed":[0,1],"masteredLessons":[0],
  "lessonStarted":["99999999999999999999","3"],"lessonTrained":[0],
  "lessonPositions":{"3":"99999999999999999999"},
  "saved":["word-1","word-2"],"foundationSaved":["hello"],
  "review":{
    "word-1":{"due":"1900-01-01","stage":"practice"},
    "word-2":{"due":"9999-12-31","stage":"retention"},
    "word-3":{"due":"1900-01-01","stage":"retained"}
  },
  "misses":{"word-1":true,"word-2":false},
  "quizHistory":[{}, {}, {}],"quizzes":7,"best":90,
  "answerStats":{"answered":10,"correct":8},
  "daily":{"1900-01-01":{"quiz":true},"1900-01-02":{"review":true},"1900-01-03":{"other":false}},
  "streak":4,"vocabLevel":"all","vocabPosition":5
}'::jsonb
where user_id = '11111111-1111-4111-8111-111111111111';

-- Use a known synthetic bearer token and store only its SHA-256 hash.
insert into public.mentor_link_tokens (token_hash, expires_at)
values (
  encode(extensions.digest(convert_to(repeat('a', 64), 'UTF8'), 'sha256'), 'hex'),
  now() + interval '1 day'
);

do $$
declare
  v_result jsonb;
  v_student jsonb;
begin
  v_result := public.mentor_get_student_overview(
    encode(extensions.digest(convert_to(repeat('a', 64), 'UTF8'), 'sha256'), 'hex')
  );
  v_student := v_result->'students'->0;
  if v_student->>'display_name' <> 'Synthetic Learner' then
    raise exception 'Overview did not return the synthetic student';
  end if;
  if v_student->'progress'->'xp' <> 'null'::jsonb then
    raise exception 'Unsafe oversized XP was not converted to null';
  end if;
  if v_student->'progress'->'current_lesson_index' <> '3'::jsonb then
    raise exception 'Active lesson index was not safely recovered from progress JSON';
  end if;
  if v_student->'progress'->'current_word_index' <> 'null'::jsonb then
    raise exception 'Out-of-range word index was not rejected';
  end if;
  if v_student->'progress'->'mastered_indices' <> '[0]'::jsonb
     or v_student->'progress'->'trained_indices' <> '[0]'::jsonb
     or v_student->'progress'->'started_indices' <> '[3]'::jsonb then
    raise exception 'Per-lesson progress indices were not safely summarized';
  end if;
  if v_student->'progress'->'saved_words_count' <> '2'::jsonb
     or v_student->'progress'->'foundation_saved_count' <> '1'::jsonb
     or v_student->'progress'->'review_words_count' <> '3'::jsonb
     or v_student->'progress'->'review_due_count' <> '1'::jsonb
     or v_student->'progress'->'missed_words_count' <> '1'::jsonb then
    raise exception 'Vocabulary or review aggregates were calculated incorrectly';
  end if;
  if v_student->'progress'->'quiz_attempts' <> '7'::jsonb
     or v_student->'progress'->'best_quiz_score' <> '90'::jsonb
     or v_student->'progress'->'answers_count' <> '10'::jsonb
     or v_student->'progress'->'correct_answers_count' <> '8'::jsonb then
    raise exception 'Quiz aggregates were calculated incorrectly';
  end if;
  if v_student->'progress'->'active_days_count' <> '2'::jsonb
     or v_student->'progress'->'learning_streak' <> '4'::jsonb
     or v_student->'progress'->'vocab_level' <> '"all"'::jsonb
     or v_student->'progress'->'vocab_position' <> '5'::jsonb then
    raise exception 'Daily activity or vocabulary level aggregates were calculated incorrectly';
  end if;
  if v_student->'progress'->'reading_completed' <> '["letter-sounds","digraphs"]'::jsonb then
    raise exception 'Mentor overview did not include the student reading stage summary';
  end if;
end;
$$;

-- Expired and revoked bearer tokens must be rejected by the RPC.
insert into public.mentor_link_tokens (token_hash, created_at, expires_at)
values (
  encode(extensions.digest(convert_to(repeat('b', 64), 'UTF8'), 'sha256'), 'hex'),
  now() - interval '2 days',
  now() - interval '1 day'
);
insert into public.mentor_link_tokens (token_hash, expires_at, revoked_at)
values (
  encode(extensions.digest(convert_to(repeat('c', 64), 'UTF8'), 'sha256'), 'hex'),
  now() + interval '1 day',
  now()
);

do $$
declare
  v_hash text;
begin
  foreach v_hash in array array[
    encode(extensions.digest(convert_to(repeat('b', 64), 'UTF8'), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to(repeat('c', 64), 'UTF8'), 'sha256'), 'hex')
  ] loop
    begin
      perform public.mentor_get_student_overview(v_hash);
      raise exception 'Expired or revoked mentor token was accepted';
    exception
      when sqlstate '28000' then null;
    end;
  end loop;
end;
$$;

-- Verify effective grants, including PostgreSQL's implicit PUBLIC privileges.
do $$
begin
  if not has_function_privilege('authenticated', 'public.record_student_activity()', 'EXECUTE') then
    raise exception 'Authenticated students cannot record last-seen activity';
  end if;
  if not has_function_privilege('authenticated', 'public.record_student_learning_activity(text,integer,integer)', 'EXECUTE') then
    raise exception 'Authenticated students cannot record learning activity';
  end if;
  if not has_function_privilege('authenticated', 'public.get_student_champions()', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_student_champions()', 'EXECUTE') then
    raise exception 'Student champions RPC grants are incorrect';
  end if;
  if has_table_privilege('authenticated', 'public.student_learning_days', 'SELECT')
     or has_table_privilege('authenticated', 'public.student_learning_days', 'INSERT')
     or has_table_privilege('anon', 'public.student_learning_days', 'SELECT')
     or has_table_privilege('authenticated', 'public.student_mastery_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.student_mastery_events', 'INSERT')
     or has_table_privilege('anon', 'public.student_mastery_events', 'SELECT') then
    raise exception 'Client roles can directly access private champion event tables';
  end if;
  if not exists (
    select 1 from pg_class
    where oid = 'public.student_learning_days'::regclass and relrowsecurity and relforcerowsecurity
  ) or not exists (
    select 1 from pg_class
    where oid = 'public.student_mastery_events'::regclass and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'Champion event tables must enforce row-level security';
  end if;
  if has_function_privilege('anon', 'public.record_student_activity()', 'EXECUTE') then
    raise exception 'Anonymous users can record student activity';
  end if;
  if has_function_privilege('authenticated', 'public.mentor_get_student_overview(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mentor_get_student_overview(text)', 'EXECUTE') then
    raise exception 'A client role can call the privileged mentor overview RPC';
  end if;
  if not has_function_privilege('service_role', 'public.mentor_get_student_overview(text)', 'EXECUTE') then
    raise exception 'Service role cannot call the mentor overview RPC';
  end if;
  if has_function_privilege('authenticated', 'public.issue_mentor_link_token(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.issue_mentor_link_token(integer)', 'EXECUTE') then
    raise exception 'A client role can issue mentor bearer tokens';
  end if;
  if has_function_privilege('authenticated', 'public.get_mentor_student_overview()', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_mentor_student_overview()', 'EXECUTE') then
    raise exception 'The retired authenticated mentor RPC remains executable';
  end if;
  if has_table_privilege('authenticated', 'public.student_activity', 'SELECT')
     or has_table_privilege('anon', 'public.student_activity', 'SELECT') then
    raise exception 'A client role can read the private student activity table';
  end if;
  if has_table_privilege('authenticated', 'public.mentor_link_tokens', 'SELECT')
     or has_table_privilege('anon', 'public.mentor_link_tokens', 'SELECT') then
    raise exception 'A client role can read private mentor token hashes';
  end if;
  if not exists (
    select 1 from pg_class
    where oid = 'public.reading_progress'::regclass and relrowsecurity
  ) then
    raise exception 'Reading progress table does not have row-level security enabled';
  end if;
  if has_table_privilege('authenticated', 'public.reading_progress', 'SELECT')
     or has_table_privilege('authenticated', 'public.reading_progress', 'INSERT')
     or has_table_privilege('authenticated', 'public.reading_progress', 'UPDATE')
     or has_table_privilege('anon', 'public.reading_progress', 'SELECT') then
    raise exception 'A client role can directly access private reading progress';
  end if;
  if not has_function_privilege('authenticated', 'public.get_my_reading_progress()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.save_my_reading_progress(text[])', 'EXECUTE') then
    raise exception 'Authenticated students cannot use their reading progress RPCs';
  end if;
  if has_function_privilege('anon', 'public.get_my_reading_progress()', 'EXECUTE')
     or has_function_privilege('anon', 'public.save_my_reading_progress(text[])', 'EXECUTE') then
    raise exception 'Anonymous users can access student reading progress RPCs';
  end if;
end;
$$;

\echo 'Mentor dashboard PostgreSQL migration tests passed.'

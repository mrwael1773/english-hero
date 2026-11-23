-- Forward-only reconciliation for the known shared test-project schema drift.
-- This migration restores the intended mentor/reading/champions objects without
-- replaying historical migration versions or changing existing student records.
-- It intentionally preserves all existing legacy activity days as unverified.

do $preflight$
begin
  if to_regclass('public.student_profiles') is null
     or to_regclass('public.student_activity') is null
     or to_regclass('public.learning_progress') is null
     or to_regclass('public.student_learning_days') is null
     or to_regclass('public.student_mastery_events') is null
     or to_regclass('public.student_champion_attempts') is null
     or to_regclass('public.student_champions_config') is null then
    raise exception 'Mentor/champions reconciliation prerequisites are missing; stop and reconcile the base schema first';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='student_learning_days'
      and column_name='first_activity_at'
  ) then
    raise exception 'student_learning_days.first_activity_at is missing; refusing partial reconciliation';
  end if;
end
$preflight$;

-- The old broad 0..99 check may remain for historical compatibility.
-- This additional NOT VALID check constrains all new writes to the real 84-lesson range
-- without rewriting or scanning historical rows.
do $lesson_bounds$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.student_mastery_events'::regclass
      and conname='student_mastery_events_valid_lesson_index'
  ) then
    alter table public.student_mastery_events
      add constraint student_mastery_events_valid_lesson_index
      check (lesson_index between 0 and 83) not valid;
  end if;
end
$lesson_bounds$;

-- Preserve the intended teacher-pilot schema without restoring browser CRUD.
-- The historical create migration grants authenticated CRUD before a later
-- migration revokes it. Reconciliation creates only missing constraints and
-- the timestamp trigger while keeping the table fail-closed.
do $teacher_pilot_preflight$
begin
  if to_regclass('public.teacher_pilot_results') is null then
    raise exception 'teacher_pilot_results is missing; refusing to reconcile an absent pilot table';
  end if;
  if exists (
    select 1 from public.teacher_pilot_results
    group by user_id, code
    having count(*) > 1
  ) then
    raise exception 'Duplicate teacher pilot owner/code rows exist; resolve them before adding the unique constraint';
  end if;
end
$teacher_pilot_preflight$;

alter table public.teacher_pilot_results force row level security;
drop policy if exists "Teachers read their own pilot results" on public.teacher_pilot_results;
drop policy if exists "Teachers insert their own pilot results" on public.teacher_pilot_results;
drop policy if exists "Teachers update their own pilot results" on public.teacher_pilot_results;
drop policy if exists "Teachers delete their own pilot results" on public.teacher_pilot_results;
revoke all privileges on table public.teacher_pilot_results from public, anon, authenticated;

do $teacher_pilot_constraints$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.teacher_pilot_results'::regclass and conname='teacher_pilot_results_code_check') then
    alter table public.teacher_pilot_results add constraint teacher_pilot_results_code_check check (code ~ '^P[0-9]{2,3}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.teacher_pilot_results'::regclass and conname='teacher_pilot_results_pre_score_check') then
    alter table public.teacher_pilot_results add constraint teacher_pilot_results_pre_score_check check (pre_score between 0 and 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.teacher_pilot_results'::regclass and conname='teacher_pilot_results_post_score_check') then
    alter table public.teacher_pilot_results add constraint teacher_pilot_results_post_score_check check (post_score between 0 and 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.teacher_pilot_results'::regclass and conname='teacher_pilot_results_retention_score_check') then
    alter table public.teacher_pilot_results add constraint teacher_pilot_results_retention_score_check check (retention_score is null or retention_score between 0 and 100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.teacher_pilot_results'::regclass and conname='teacher_pilot_results_sessions_attended_check') then
    alter table public.teacher_pilot_results add constraint teacher_pilot_results_sessions_attended_check check (sessions_attended between 0 and 16) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.teacher_pilot_results'::regclass and conname='teacher_pilot_results_learning_note_check') then
    alter table public.teacher_pilot_results add constraint teacher_pilot_results_learning_note_check check (learning_note is null or char_length(learning_note) <= 240) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.teacher_pilot_results'::regclass and conname='teacher_pilot_results_user_id_code_key') then
    alter table public.teacher_pilot_results add constraint teacher_pilot_results_user_id_code_key unique (user_id, code);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.teacher_pilot_results'::regclass and conname='teacher_pilot_results_session_log_check') then
    alter table public.teacher_pilot_results add constraint teacher_pilot_results_session_log_check check (jsonb_typeof(session_log) = 'array' and jsonb_array_length(session_log) <= 16) not valid;
  end if;
end
$teacher_pilot_constraints$;

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

drop trigger if exists set_teacher_pilot_results_updated_at on public.teacher_pilot_results;
create trigger set_teacher_pilot_results_updated_at
before update on public.teacher_pilot_results
for each row execute function public.set_teacher_pilot_results_updated_at();
revoke all on function public.set_teacher_pilot_results_updated_at() from public, anon, authenticated;

-- Reconciled source:

 supabase/migrations/20261118110000_mentor_passwordless_link_access.sql
-- Passwordless mentor access through a revocable, expiring bearer link.
-- The raw token is returned only once by an owner-only provisioning function.
create table if not exists public.mentor_link_tokens (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint mentor_link_tokens_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint mentor_link_tokens_expiry check (expires_at > created_at)
);

alter table public.mentor_link_tokens enable row level security;
revoke all on public.mentor_link_tokens from public, anon, authenticated;

create or replace function public.issue_mentor_link_token(p_expires_in_days integer default 30)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if p_expires_in_days < 1 or p_expires_in_days > 90 then
    raise exception 'Expiry must be between 1 and 90 days';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.mentor_link_tokens(token_hash, expires_at)
  values (
    encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
    now() + make_interval(days => p_expires_in_days)
  );

  return v_token;
end;
$$;

revoke all on function public.issue_mentor_link_token(integer) from public, anon, authenticated;
grant execute on function public.issue_mentor_link_token(integer) to postgres;

comment on table public.mentor_link_tokens is
  'Stores only SHA-256 hashes of mentor bearer-link tokens. Raw tokens are returned once at issuance.';


-- Reconciled source: supabase/migrations/20261121120000_mentor_comprehensive_progress_summary.sql
-- Student reading completion is the only reading data synced to the school view.
-- Do not store answers, reading text, or free-form interaction history here.
create table if not exists public.reading_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  completed_stage_ids text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  constraint reading_progress_stage_count check (cardinality(completed_stage_ids) between 0 and 11)
);
alter table public.reading_progress enable row level security;
revoke all on table public.reading_progress from public, anon, authenticated;

create or replace function public.get_my_reading_progress()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_completed text[] := '{}'::text[];
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select rp.completed_stage_ids into v_completed
  from public.reading_progress as rp
  where rp.user_id = v_user_id;
  return coalesce(v_completed, '{}'::text[]);
end;
$$;

create or replace function public.save_my_reading_progress(p_completed text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_allowed constant text[] := array[
    'letter-sounds','digraphs','short-vowels','blends','cvc','magic-e',
    'vowel-teams','r-controlled','diphthongs','syllables','practice'
  ]::text[];
  v_result text[] := '{}'::text[];
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_completed is null or cardinality(p_completed) > cardinality(v_allowed) then
    raise exception 'Invalid reading progress' using errcode = '22023';
  end if;
  v_count := cardinality(p_completed);
  if v_count > 0 and p_completed is distinct from v_allowed[1:v_count] then
    raise exception 'Reading stages must be completed in order' using errcode = '22023';
  end if;
  insert into public.reading_progress(user_id, completed_stage_ids, updated_at)
  values (v_user_id, p_completed, now())
  on conflict (user_id) do update
    set completed_stage_ids = case
      when cardinality(public.reading_progress.completed_stage_ids) >= cardinality(excluded.completed_stage_ids)
        then public.reading_progress.completed_stage_ids
      else excluded.completed_stage_ids
    end,
    updated_at = now()
  returning completed_stage_ids into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_my_reading_progress() from public, anon;
grant execute on function public.get_my_reading_progress() to authenticated;
revoke all on function public.save_my_reading_progress(text[]) from public, anon;
grant execute on function public.save_my_reading_progress(text[]) to authenticated;

create or replace function public.mentor_get_student_overview(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_students jsonb;
  v_now timestamptz;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid or expired mentor link' using errcode = '28000';
  end if;

  -- Lock the token row so revocation cannot race between validation and data retrieval.
  perform 1
  from public.mentor_link_tokens as t
  where t.token_hash = p_token_hash
    and t.revoked_at is null
    and t.expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception 'Invalid or expired mentor link' using errcode = '28000';
  end if;

  v_now := clock_timestamp();
  update public.mentor_link_tokens
  set last_used_at = v_now
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > v_now;

  if not found then
    raise exception 'Invalid or expired mentor link' using errcode = '28000';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'display_name', p.display_name,
        'last_seen_at', a.last_seen_at,
        'progress', jsonb_build_object(
          'xp', case
            when (lp.progress->>'xp') ~ '^(0|[1-9][0-9]{0,15})$' then
              case
                when (lp.progress->>'xp')::numeric <= 9007199254740991
                then to_jsonb((lp.progress->>'xp')::bigint)
                else null
              end
            else null
          end,
          'completed_count', case
            when jsonb_typeof(lp.progress->'completed') = 'array'
            then jsonb_array_length(lp.progress->'completed') else 0 end,
          'mastered_count', case
            when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
            then jsonb_array_length(lp.progress->'masteredLessons') else 0 end,
          'started_count', case
            when jsonb_typeof(lp.progress->'lessonStarted') = 'array'
            then jsonb_array_length(lp.progress->'lessonStarted') else 0 end,
          'trained_count', case
            when jsonb_typeof(lp.progress->'lessonTrained') = 'array'
            then jsonb_array_length(lp.progress->'lessonTrained') else 0 end,
          'mastered_indices', (
            select coalesce(jsonb_agg(idx order by idx) filter (where idx is not null), '[]'::jsonb)
            from (
              select case when value ~ '^(0|[1-9][0-9]?)$' then value::integer else null end as idx
              from jsonb_array_elements_text(case when jsonb_typeof(lp.progress->'masteredLessons')='array' then lp.progress->'masteredLessons' else '[]'::jsonb end)
            ) as parsed
            where idx between 0 and 99
          ),
          'trained_indices', (
            select coalesce(jsonb_agg(idx order by idx) filter (where idx is not null), '[]'::jsonb)
            from (
              select case when value ~ '^(0|[1-9][0-9]?)$' then value::integer else null end as idx
              from jsonb_array_elements_text(case when jsonb_typeof(lp.progress->'lessonTrained')='array' then lp.progress->'lessonTrained' else '[]'::jsonb end)
            ) as parsed
            where idx between 0 and 99
          ),
          'started_indices', (
            select coalesce(jsonb_agg(idx order by idx) filter (where idx is not null), '[]'::jsonb)
            from (
              select case when value ~ '^(0|[1-9][0-9]?)$' then value::integer else null end as idx
              from jsonb_array_elements_text(case when jsonb_typeof(lp.progress->'lessonStarted')='array' then lp.progress->'lessonStarted' else '[]'::jsonb end)
            ) as parsed
            where idx between 0 and 99
          ),
          'saved_words_count', case when jsonb_typeof(lp.progress->'saved')='array' then jsonb_array_length(lp.progress->'saved') else 0 end,
          'foundation_saved_count', case when jsonb_typeof(lp.progress->'foundationSaved')='array' then jsonb_array_length(lp.progress->'foundationSaved') else 0 end,
          'review_words_count', (
            select count(*) from jsonb_each(case when jsonb_typeof(lp.progress->'review')='object' then lp.progress->'review' else '{}'::jsonb end)
          ),
          'review_due_count', (
            select count(*) from jsonb_each(case when jsonb_typeof(lp.progress->'review')='object' then lp.progress->'review' else '{}'::jsonb end) as r(word_id, item)
            where jsonb_typeof(r.item)='object'
              and coalesce(r.item->>'due','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              and (r.item->>'due') <= to_char((now() at time zone 'Asia/Riyadh')::date,'YYYY-MM-DD')
              and coalesce(r.item->>'stage','') <> 'retained'
          ),
          'missed_words_count', (
            select count(*) from jsonb_each(case when jsonb_typeof(lp.progress->'misses')='object' then lp.progress->'misses' else '{}'::jsonb end) as m(word_id, missed)
            where m.missed = 'true'::jsonb
          ),
          'quiz_attempts', case
            when (lp.progress->>'quizzes') ~ '^(0|[1-9][0-9]{0,8})$'
              then (lp.progress->>'quizzes')::integer else 0 end,
          'best_quiz_score', case
            when (lp.progress->>'best') ~ '^(0|[1-9][0-9]?)$' then
              case when (lp.progress->>'best')::integer <= 100 then (lp.progress->>'best')::integer else null end
            else null end,
          'answers_count', case
            when (lp.progress->'answerStats'->>'answered') ~ '^(0|[1-9][0-9]{0,8})$'
              then (lp.progress->'answerStats'->>'answered')::integer else 0 end,
          'correct_answers_count', case
            when (lp.progress->'answerStats'->>'correct') ~ '^(0|[1-9][0-9]{0,8})$'
              then (lp.progress->'answerStats'->>'correct')::integer else 0 end,
          'active_days_count', (
            select count(*) from jsonb_each(case when jsonb_typeof(lp.progress->'daily')='object' then lp.progress->'daily' else '{}'::jsonb end) as d(day_key,tasks)
            where d.day_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              and jsonb_typeof(d.tasks)='object'
              and exists(
                select 1 from jsonb_each(case when jsonb_typeof(d.tasks)='object' then d.tasks else '{}'::jsonb end) as t(task_key,task_value)
                where t.task_value='true'::jsonb
              )
          ),
          'learning_streak', case
            when (lp.progress->>'streak') ~ '^(0|[1-9][0-9]{0,5})$'
              then (lp.progress->>'streak')::integer else 0 end,
          'vocab_level', case when jsonb_typeof(lp.progress->'vocabLevel') in ('string','number')
            then left(lp.progress->>'vocabLevel',24) else null end,
          'vocab_position', case
            when (lp.progress->>'vocabPosition') ~ '^(0|[1-9][0-9]{0,4})$' then
              case when (lp.progress->>'vocabPosition')::integer <= 19999
                then (lp.progress->>'vocabPosition')::integer else null end
            else null end,
          'reading_completed', coalesce(to_jsonb(rp.completed_stage_ids),'[]'::jsonb),
          'current_lesson_index', coalesce(a.current_lesson_index, active_lesson.lesson_index),
          'current_word_index', coalesce(
            a.current_word_index,
            case
              when (lp.progress->'lessonPositions'->>(coalesce(a.current_lesson_index, active_lesson.lesson_index)::text)) ~ '^[0-9]{1,2}$'
              then (lp.progress->'lessonPositions'->>(coalesce(a.current_lesson_index, active_lesson.lesson_index)::text))::integer
              else null
            end
          ),
          'last_action', a.last_learning_action,
          'last_action_at', a.last_learning_activity_at,
          'last_action_lesson_index', a.last_learning_lesson_index,
          'last_action_word_index', a.last_learning_word_index
        )
      )
      order by p.display_name, p.username
    ),
    '[]'::jsonb
  )
  into v_students
  from public.student_profiles as p
  left join public.student_activity as a on a.user_id = p.user_id
  left join public.learning_progress as lp on lp.user_id = p.user_id
  left join public.reading_progress as rp on rp.user_id = p.user_id
  left join lateral (
    select started.lesson_index
    from (
      select
        case
          when lesson_index_text ~ '^[0-9]{1,2}$' then lesson_index_text::integer
          else null
        end as lesson_index,
        ordinal
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(lp.progress->'lessonStarted') = 'array'
          then lp.progress->'lessonStarted'
          else '[]'::jsonb
        end
      ) with ordinality as raw_started(lesson_index_text, ordinal)
    ) as started
    where started.lesson_index between 0 and 99
      and not (
        case
          when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
          then lp.progress->'masteredLessons'
          else '[]'::jsonb
        end @> jsonb_build_array(started.lesson_index)
      )
    order by started.ordinal desc
    limit 1
  ) as active_lesson on true;

  return jsonb_build_object(
    'students', v_students,
    'generated_at', v_now
  );
end;
$$;
revoke all on function public.mentor_get_student_overview(text) from public, anon, authenticated;
grant execute on function public.mentor_get_student_overview(text) to service_role;

comment on table public.student_activity is
  'Minimal latest activity marker and last-seen timestamp; no answer content, IP address, or device fingerprint is stored.';
comment on function public.record_student_learning_activity(text, integer, integer) is
  'Stores only the latest allowlisted learning action and numeric lesson position for the authenticated student.';

-- Retire the earlier authenticated mentor RPC. The passwordless bearer-link
-- Edge Function is now the only supported mentor overview entry point.
-- Keep the function definition for rollback compatibility, but remove client execution.
revoke all on function public.get_mentor_student_overview() from public, anon, authenticated;


-- Reconciled source: supabase/migrations/20261122230000_reject_client_mastery_claims.sql
-- Prevent authenticated clients from forging mastery events through their own editable progress snapshot.
-- Preserve the hardened 0..83 lesson-index validation from the preceding migration.
-- Only the service-role challenge completion path may write student_mastery_events.

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
  v_day date := (v_now at time zone 'Asia/Riyadh')::date;
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

  -- This browser-callable RPC must never create mastery from editable progress.
  -- Only the server-verified challenge completion function can record mastery.
  if p_action = 'lesson_mastered' then
    raise exception 'Mastery must be verified by a server challenge' using errcode = '42501';
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

revoke all on function public.record_student_learning_activity(text, integer, integer) from public, anon;
grant execute on function public.record_student_learning_activity(text, integer, integer) to authenticated;


-- Reconciled source: supabase/migrations/20261122233000_verified_mentor_mastery_metrics.sql
-- Existing student_learning_days rows were created before server challenge
-- verification and must remain historical/unverified rather than being trusted.
alter table public.student_learning_days
  add column if not exists verification_source text not null default 'legacy_unverified';

-- IF NOT EXISTS on ADD COLUMN does not repair a missing CHECK constraint when
-- a partially reconciled environment already has the column. Ensure the
-- constraint independently, without changing or reclassifying existing rows.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.student_learning_days'::regclass
      and conname = 'student_learning_days_verification_source_check'
  ) then
    alter table public.student_learning_days
      add constraint student_learning_days_verification_source_check
      check (verification_source in ('legacy_unverified', 'challenge_verified'));
  end if;
end
$$;

-- A successful one-use server challenge is the only path that upgrades a day
-- to verified. A legacy row for the same day is upgraded only after this proof.
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

  insert into public.student_learning_days(user_id, activity_day, first_activity_at, verification_source)
  values (p_user_id, (v_now at time zone 'Asia/Riyadh')::date, v_now, 'challenge_verified')
  on conflict (user_id, activity_day) do update
    set verification_source = 'challenge_verified',
        first_activity_at = least(public.student_learning_days.first_activity_at, excluded.first_activity_at);

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

-- Consistency rankings count only challenge-verified days, never old client-reported days.
create or replace function public.get_student_champions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_week_start date;
  v_elapsed_days integer;
  v_today_leaders jsonb;
  v_week_leaders jsonb;
  v_mastery_leaders jsonb;
  v_consistency_leaders jsonb;
  v_improvement_leaders jsonb := '[]'::jsonb;
  v_tracking_started_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_elapsed_days := extract(dow from v_today)::integer;
  v_week_start := v_today - v_elapsed_days;
  select activated_at into v_tracking_started_at
  from public.student_champions_config where singleton = true;
  if not found then v_tracking_started_at := v_now; end if;

  select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
    order by r.score desc, r.first_at asc, r.display_name asc, r.user_id asc), '[]'::jsonb)
  into v_today_leaders
  from (
    select p.user_id, p.display_name, count(*)::integer score, min(e.mastered_at) first_at
    from public.student_mastery_events e
    join public.student_profiles p on p.user_id = e.user_id
    where (e.mastered_at at time zone 'Asia/Riyadh')::date = v_today
      and e.lesson_index between 0 and 83
      and p.display_name is not null and btrim(p.display_name) <> ''
    group by p.user_id, p.display_name
    order by score desc, first_at asc, p.display_name asc, p.user_id asc limit 3
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
    order by r.score desc, r.first_at asc, r.display_name asc, r.user_id asc), '[]'::jsonb)
  into v_week_leaders
  from (
    select p.user_id, p.display_name, count(*)::integer score, min(e.mastered_at) first_at
    from public.student_mastery_events e
    join public.student_profiles p on p.user_id = e.user_id
    where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today
      and e.lesson_index between 0 and 83
      and p.display_name is not null and btrim(p.display_name) <> ''
    group by p.user_id, p.display_name
    order by score desc, first_at asc, p.display_name asc, p.user_id asc limit 3
  ) r;

  -- Use the private, deduplicated mastery-event ledger as the source for this category.
  -- Mutable client progress JSON is deliberately not used for leaderboard scoring.
  select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
    order by r.score desc, r.display_name asc, r.user_id asc), '[]'::jsonb)
  into v_mastery_leaders
  from (
    select p.user_id, p.display_name, count(*)::integer score
    from public.student_mastery_events e
    join public.student_profiles p on p.user_id = e.user_id
    where e.lesson_index between 0 and 83
      and p.display_name is not null and btrim(p.display_name) <> ''
    group by p.user_id, p.display_name
    order by score desc, p.display_name asc, p.user_id asc limit 3
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
    order by r.score desc, r.display_name asc, r.user_id asc), '[]'::jsonb)
  into v_consistency_leaders
  from (
    select p.user_id, p.display_name, count(*)::integer score
    from public.student_learning_days d
    join public.student_profiles p on p.user_id = d.user_id
    where d.activity_day between v_today - 6 and v_today
      and d.verification_source = 'challenge_verified'
      and p.display_name is not null and btrim(p.display_name) <> ''
    group by p.user_id, p.display_name
    order by score desc, p.display_name asc, p.user_id asc limit 3
  ) r;

  -- Compare equal-length elapsed periods only after a complete post-activation baseline.
  if v_today >= (v_tracking_started_at at time zone 'Asia/Riyadh')::date + 14 then
    select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
      order by r.score desc, r.current_count desc, r.display_name asc, r.user_id asc), '[]'::jsonb)
    into v_improvement_leaders
    from (
      select p.user_id, p.display_name,
        (count(*) filter (where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today)
         - count(*) filter (where (e.mastered_at at time zone 'Asia/Riyadh')::date
           between v_week_start - 7 and v_week_start - 7 + v_elapsed_days))::integer score,
        count(*) filter (where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today)::integer current_count
      from public.student_mastery_events e
      join public.student_profiles p on p.user_id = e.user_id
      where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start - 7 and v_today
        and e.lesson_index between 0 and 83
        and p.display_name is not null and btrim(p.display_name) <> ''
      group by p.user_id, p.display_name
      having count(*) filter (where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today)
        > count(*) filter (where (e.mastered_at at time zone 'Asia/Riyadh')::date
          between v_week_start - 7 and v_week_start - 7 + v_elapsed_days)
      order by score desc, current_count desc, p.display_name asc, p.user_id asc limit 3
    ) r;
  end if;

  return jsonb_build_object(
    'generated_at', v_now, 'timezone', 'Asia/Riyadh', 'week_start', v_week_start, 'today', v_today,
    'today_leaders', v_today_leaders, 'week_leaders', v_week_leaders,
    'mastery_leaders', v_mastery_leaders, 'consistency_leaders', v_consistency_leaders,
    'improvement_leaders', v_improvement_leaders
  );
end;
$$;

revoke all on function public.get_student_champions() from public, anon;
grant execute on function public.get_student_champions() to authenticated;

-- Mentor reporting uses the same authoritative day source as the champions view.
create or replace function public.mentor_get_student_overview(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_students jsonb;
  v_now timestamptz;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid or expired mentor link' using errcode = '28000';
  end if;

  -- Lock the token row so revocation cannot race between validation and data retrieval.
  perform 1
  from public.mentor_link_tokens as t
  where t.token_hash = p_token_hash
    and t.revoked_at is null
    and t.expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception 'Invalid or expired mentor link' using errcode = '28000';
  end if;

  v_now := clock_timestamp();
  update public.mentor_link_tokens
  set last_used_at = v_now
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > v_now;

  if not found then
    raise exception 'Invalid or expired mentor link' using errcode = '28000';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'display_name', p.display_name,
        'last_seen_at', a.last_seen_at,
        'progress', jsonb_build_object(
          'xp', case
            when (lp.progress->>'xp') ~ '^(0|[1-9][0-9]{0,15})$' then
              case
                when (lp.progress->>'xp')::numeric <= 9007199254740991
                then to_jsonb((lp.progress->>'xp')::bigint)
                else null
              end
            else null
          end,
          'completed_count', case
            when jsonb_typeof(lp.progress->'completed') = 'array'
            then jsonb_array_length(lp.progress->'completed') else 0 end,
          'mastered_count', (
            select count(*)::integer from public.student_mastery_events as me
            where me.user_id = p.user_id and me.lesson_index between 0 and 83
          ),
          'started_count', case
            when jsonb_typeof(lp.progress->'lessonStarted') = 'array'
            then jsonb_array_length(lp.progress->'lessonStarted') else 0 end,
          'trained_count', case
            when jsonb_typeof(lp.progress->'lessonTrained') = 'array'
            then jsonb_array_length(lp.progress->'lessonTrained') else 0 end,
          'mastered_indices', (
            select coalesce(jsonb_agg(me.lesson_index order by me.lesson_index), '[]'::jsonb)
            from public.student_mastery_events as me
            where me.user_id = p.user_id and me.lesson_index between 0 and 83
          ),
          'trained_indices', (
            select coalesce(jsonb_agg(idx order by idx) filter (where idx is not null), '[]'::jsonb)
            from (
              select case when value ~ '^(0|[1-9][0-9]?)$' then value::integer else null end as idx
              from jsonb_array_elements_text(case when jsonb_typeof(lp.progress->'lessonTrained')='array' then lp.progress->'lessonTrained' else '[]'::jsonb end)
            ) as parsed
            where idx between 0 and 99
          ),
          'started_indices', (
            select coalesce(jsonb_agg(idx order by idx) filter (where idx is not null), '[]'::jsonb)
            from (
              select case when value ~ '^(0|[1-9][0-9]?)$' then value::integer else null end as idx
              from jsonb_array_elements_text(case when jsonb_typeof(lp.progress->'lessonStarted')='array' then lp.progress->'lessonStarted' else '[]'::jsonb end)
            ) as parsed
            where idx between 0 and 99
          ),
          'saved_words_count', case when jsonb_typeof(lp.progress->'saved')='array' then jsonb_array_length(lp.progress->'saved') else 0 end,
          'foundation_saved_count', case when jsonb_typeof(lp.progress->'foundationSaved')='array' then jsonb_array_length(lp.progress->'foundationSaved') else 0 end,
          'review_words_count', (
            select count(*) from jsonb_each(case when jsonb_typeof(lp.progress->'review')='object' then lp.progress->'review' else '{}'::jsonb end)
          ),
          'review_due_count', (
            select count(*) from jsonb_each(case when jsonb_typeof(lp.progress->'review')='object' then lp.progress->'review' else '{}'::jsonb end) as r(word_id, item)
            where jsonb_typeof(r.item)='object'
              and coalesce(r.item->>'due','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              and (r.item->>'due') <= to_char((now() at time zone 'Asia/Riyadh')::date,'YYYY-MM-DD')
              and coalesce(r.item->>'stage','') <> 'retained'
          ),
          'missed_words_count', (
            select count(*) from jsonb_each(case when jsonb_typeof(lp.progress->'misses')='object' then lp.progress->'misses' else '{}'::jsonb end) as m(word_id, missed)
            where m.missed = 'true'::jsonb
          ),
          'quiz_attempts', case
            when (lp.progress->>'quizzes') ~ '^(0|[1-9][0-9]{0,8})$'
              then (lp.progress->>'quizzes')::integer else 0 end,
          'best_quiz_score', case
            when (lp.progress->>'best') ~ '^(0|[1-9][0-9]?)$' then
              case when (lp.progress->>'best')::integer <= 100 then (lp.progress->>'best')::integer else null end
            else null end,
          'answers_count', case
            when (lp.progress->'answerStats'->>'answered') ~ '^(0|[1-9][0-9]{0,8})$'
              then (lp.progress->'answerStats'->>'answered')::integer else 0 end,
          'correct_answers_count', case
            when (lp.progress->'answerStats'->>'correct') ~ '^(0|[1-9][0-9]{0,8})$'
              then (lp.progress->'answerStats'->>'correct')::integer else 0 end,
          'active_days_count', (
            select count(*)::integer from public.student_learning_days as d
            where d.user_id = p.user_id
              and d.verification_source = 'challenge_verified'
          ),
          'learning_streak', coalesce((
            with activity_days as (
              select d.activity_day,
                row_number() over (order by d.activity_day desc) - 1 as day_offset
              from public.student_learning_days as d
              where d.user_id = p.user_id
                and d.verification_source = 'challenge_verified'
                and d.activity_day <= (now() at time zone 'Asia/Riyadh')::date
            ),
            latest_day as (
              select max(d.activity_day) as activity_day
              from public.student_learning_days as d
              where d.user_id = p.user_id
                and d.verification_source = 'challenge_verified'
            )
            select case
              when ld.activity_day >= (now() at time zone 'Asia/Riyadh')::date - 1
              then count(*)::integer else 0
            end
            from activity_days as ad
            cross join latest_day as ld
            where ad.activity_day = ld.activity_day - ad.day_offset::integer
            group by ld.activity_day
          ), 0),
          'vocab_level', case when jsonb_typeof(lp.progress->'vocabLevel') in ('string','number')
            then left(lp.progress->>'vocabLevel',24) else null end,
          'vocab_position', case
            when (lp.progress->>'vocabPosition') ~ '^(0|[1-9][0-9]{0,4})$' then
              case when (lp.progress->>'vocabPosition')::integer <= 19999
                then (lp.progress->>'vocabPosition')::integer else null end
            else null end,
          'reading_completed', coalesce(to_jsonb(rp.completed_stage_ids),'[]'::jsonb),
          'current_lesson_index', coalesce(a.current_lesson_index, active_lesson.lesson_index),
          'current_word_index', coalesce(
            a.current_word_index,
            case
              when (lp.progress->'lessonPositions'->>(coalesce(a.current_lesson_index, active_lesson.lesson_index)::text)) ~ '^[0-9]{1,2}$'
              then (lp.progress->'lessonPositions'->>(coalesce(a.current_lesson_index, active_lesson.lesson_index)::text))::integer
              else null
            end
          ),
          'last_action', a.last_learning_action,
          'last_action_at', a.last_learning_activity_at,
          'last_action_lesson_index', a.last_learning_lesson_index,
          'last_action_word_index', a.last_learning_word_index
        )
      )
      order by p.display_name, p.username
    ),
    '[]'::jsonb
  )
  into v_students
  from public.student_profiles as p
  left join public.student_activity as a on a.user_id = p.user_id
  left join public.learning_progress as lp on lp.user_id = p.user_id
  left join public.reading_progress as rp on rp.user_id = p.user_id
  left join lateral (
    select started.lesson_index
    from (
      select
        case
          when lesson_index_text ~ '^[0-9]{1,2}$' then lesson_index_text::integer
          else null
        end as lesson_index,
        ordinal
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(lp.progress->'lessonStarted') = 'array'
          then lp.progress->'lessonStarted'
          else '[]'::jsonb
        end
      ) with ordinality as raw_started(lesson_index_text, ordinal)
    ) as started
    where started.lesson_index between 0 and 99
      and not (
        case
          when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
          then lp.progress->'masteredLessons'
          else '[]'::jsonb
        end @> jsonb_build_array(started.lesson_index)
      )
    order by started.ordinal desc
    limit 1
  ) as active_lesson on true;

  return jsonb_build_object(
    'students', v_students,
    'generated_at', v_now
  );
end;
$$;

revoke all on function public.mentor_get_student_overview(text) from public, anon, authenticated;
grant execute on function public.mentor_get_student_overview(text) to service_role;

comment on column public.student_learning_days.verification_source is
  'legacy_unverified rows preserve historical client-reported activity; challenge_verified rows are written only after server-scored champion challenge submission.';
comment on function public.get_student_champions() is
  'Returns aggregate champion rankings; mastery uses the private mastery-event ledger and consistency uses only server-verified challenge days.';
comment on function public.mentor_get_student_overview(text) is
  'Returns verified mastery and challenge-day aggregates from private server ledgers; mutable learning progress is an app-reported snapshot.';

-- Fail closed if a partially existing object did not match the required shape.
do $postflight$
begin
  if not exists (
    select 1 from pg_class
    where oid='public.teacher_pilot_results'::regclass and relrowsecurity and relforcerowsecurity
  ) then
    raise exception 'Reconciliation postflight failed: teacher pilot table must enforce RLS';
  end if;

  if has_table_privilege('anon','public.teacher_pilot_results','SELECT')
     or has_table_privilege('anon','public.teacher_pilot_results','INSERT')
     or has_table_privilege('anon','public.teacher_pilot_results','UPDATE')
     or has_table_privilege('anon','public.teacher_pilot_results','DELETE')
     or has_table_privilege('authenticated','public.teacher_pilot_results','SELECT')
     or has_table_privilege('authenticated','public.teacher_pilot_results','INSERT')
     or has_table_privilege('authenticated','public.teacher_pilot_results','UPDATE')
     or has_table_privilege('authenticated','public.teacher_pilot_results','DELETE') then
    raise exception 'Reconciliation postflight failed: teacher pilot client grants detected';
  end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='teacher_pilot_results') then
    raise exception 'Reconciliation postflight failed: teacher pilot client policies detected';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.teacher_pilot_results'::regclass
      and tgname='set_teacher_pilot_results_updated_at' and not tgisinternal
  ) then
    raise exception 'Reconciliation postflight failed: teacher pilot timestamp trigger is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='mentor_link_tokens' and column_name='token_hash')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='mentor_link_tokens' and column_name='expires_at')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='reading_progress' and column_name='completed_stage_ids')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='student_learning_days' and column_name='verification_source')
  then
    raise exception 'Reconciliation postflight failed: required columns are missing';
  end if;

  if has_table_privilege('anon','public.mentor_link_tokens','SELECT')
     or has_table_privilege('authenticated','public.mentor_link_tokens','SELECT')
     or has_table_privilege('anon','public.reading_progress','SELECT')
     or has_table_privilege('authenticated','public.reading_progress','SELECT') then
    raise exception 'Reconciliation postflight failed: private table grants detected';
  end if;

  if has_function_privilege('authenticated','public.mentor_get_student_overview(text)','EXECUTE')
     or not has_function_privilege('service_role','public.mentor_get_student_overview(text)','EXECUTE') then
    raise exception 'Reconciliation postflight failed: mentor overview RPC grants are unsafe';
  end if;
end
$postflight$;

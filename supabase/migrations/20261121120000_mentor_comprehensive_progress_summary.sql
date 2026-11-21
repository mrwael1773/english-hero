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
          'quiz_attempts', case when jsonb_typeof(lp.progress->'quizHistory')='array' then jsonb_array_length(lp.progress->'quizHistory') else 0 end,
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

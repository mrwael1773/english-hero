-- Classify the four existing supervisor accounts by stable account identity.
-- No account, profile, progress, or activity row is deleted or rewritten.
-- Abort if the expected accounts are not all present exactly once.
alter table public.student_access_roles
  drop constraint if exists student_access_roles_role_check;
alter table public.student_access_roles
  add constraint student_access_roles_role_check
  check (role in ('mentor', 'supervisor'));

do $$
declare
  v_supervisor_count integer;
begin
  select count(*) into v_supervisor_count
  from public.student_profiles
  where username in ('1013506835', 'wael_2009', 'mahmud', 'iii');
  if v_supervisor_count <> 4 then
    raise exception 'Expected exactly four known supervisor accounts; found %', v_supervisor_count;
  end if;
end;
$$;

insert into public.student_access_roles(user_id, role)
select p.user_id, 'supervisor'
from public.student_profiles as p
where p.username in ('1013506835', 'wael_2009', 'mahmud', 'iii')
on conflict (user_id, role) do nothing;

CREATE OR REPLACE FUNCTION public.mentor_get_student_overview(p_token_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  ) as active_lesson on true
  where not exists (
    select 1 from public.student_access_roles as supervisor_role
    where supervisor_role.user_id = p.user_id and supervisor_role.role = 'supervisor'
  );

  return jsonb_build_object(
    'students', v_students,
    'generated_at', v_now
  );
end;
$function$;

revoke all on function public.mentor_get_student_overview(text) from public, anon, authenticated;
grant execute on function public.mentor_get_student_overview(text) to service_role;

CREATE OR REPLACE FUNCTION public.get_student_champions()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and not exists (select 1 from public.student_access_roles as sr where sr.user_id = p.user_id and sr.role = 'supervisor')
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
      and not exists (select 1 from public.student_access_roles as sr where sr.user_id = p.user_id and sr.role = 'supervisor')
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
      and not exists (select 1 from public.student_access_roles as sr where sr.user_id = p.user_id and sr.role = 'supervisor')
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
      and not exists (select 1 from public.student_access_roles as sr where sr.user_id = p.user_id and sr.role = 'supervisor')
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
        and not exists (select 1 from public.student_access_roles as sr where sr.user_id = p.user_id and sr.role = 'supervisor')
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
$function$;

revoke all on function public.get_student_champions() from public, anon;
grant execute on function public.get_student_champions() to authenticated;

comment on table public.student_access_roles is
  'Privileged application roles (mentor and supervisor); assignments must be provisioned by a trusted database administrator.';

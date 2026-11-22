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

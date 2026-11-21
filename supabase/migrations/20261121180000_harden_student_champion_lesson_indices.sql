-- Bound leaderboard mastery to the site's 84 real lessons (indices 0..83).
-- Existing out-of-range events are preserved but excluded from all leaderboard aggregates.
-- NOT VALID avoids scanning or modifying historical rows; PostgreSQL still enforces it for new writes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.student_mastery_events'::regclass
      AND conname = 'student_mastery_events_valid_lesson_index'
  ) THEN
    ALTER TABLE public.student_mastery_events
      ADD CONSTRAINT student_mastery_events_valid_lesson_index
      CHECK (lesson_index BETWEEN 0 AND 83) NOT VALID;
  END IF;
END
$$;

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
  if p_action like 'lesson_%' and p_lesson_index is null then
    raise exception 'Lesson index required' using errcode = '22023';
  end if;

  -- A mastery event is accepted only after the authenticated learner's
  -- current cloud progress contains that lesson as mastered.
  if p_action = 'lesson_mastered' and not exists (
    select 1
    from public.learning_progress as lp
    where lp.user_id = v_user_id
      and jsonb_typeof(lp.progress->'masteredLessons') = 'array'
      and lp.progress->'masteredLessons' @> jsonb_build_array(p_lesson_index)
  ) then
    raise exception 'Lesson mastery must be synced before recording' using errcode = '22023';
  end if;

  insert into public.student_learning_days(user_id, activity_day, first_activity_at)
  values (v_user_id, v_day, v_now)
  on conflict (user_id, activity_day) do nothing;

  if p_action = 'lesson_mastered' then
    insert into public.student_mastery_events(user_id, lesson_index, mastered_at)
    values (v_user_id, p_lesson_index, v_now)
    on conflict (user_id, lesson_index) do nothing;
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
    order by r.score desc, r.first_at asc, r.display_name asc), '[]'::jsonb)
  into v_today_leaders
  from (
    select p.display_name, count(*)::integer score, min(e.mastered_at) first_at
    from public.student_mastery_events e
    join public.student_profiles p on p.user_id = e.user_id
    where (e.mastered_at at time zone 'Asia/Riyadh')::date = v_today
      and e.lesson_index between 0 and 83
      and p.display_name is not null and btrim(p.display_name) <> ''
    group by p.user_id, p.display_name
    order by score desc, first_at asc, p.display_name asc limit 3
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
    order by r.score desc, r.first_at asc, r.display_name asc), '[]'::jsonb)
  into v_week_leaders
  from (
    select p.display_name, count(*)::integer score, min(e.mastered_at) first_at
    from public.student_mastery_events e
    join public.student_profiles p on p.user_id = e.user_id
    where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today
      and e.lesson_index between 0 and 83
      and p.display_name is not null and btrim(p.display_name) <> ''
    group by p.user_id, p.display_name
    order by score desc, first_at asc, p.display_name asc limit 3
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
    order by r.score desc, r.display_name asc), '[]'::jsonb)
  into v_mastery_leaders
  from (
    select p.display_name, m.score
    from public.student_profiles p
    left join public.learning_progress lp on lp.user_id = p.user_id
    cross join lateral (
      select count(distinct (item.value #>> '{}')::integer)::integer score
      from jsonb_array_elements(
        case when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
          then lp.progress->'masteredLessons' else '[]'::jsonb end
      ) item(value)
      where jsonb_typeof(item.value) = 'number'
        and item.value::text ~ '^(0|[1-9]|[1-7][0-9]|8[0-3])
    where m.score > 0 and p.display_name is not null and btrim(p.display_name) <> ''
    order by m.score desc, p.display_name asc limit 3
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
    order by r.score desc, r.display_name asc), '[]'::jsonb)
  into v_consistency_leaders
  from (
    select p.display_name, count(*)::integer score
    from public.student_learning_days d
    join public.student_profiles p on p.user_id = d.user_id
    where d.activity_day between v_today - 6 and v_today
      and p.display_name is not null and btrim(p.display_name) <> ''
    group by p.user_id, p.display_name
    order by score desc, p.display_name asc limit 3
  ) r;

  -- Compare equal-length elapsed periods only after a complete post-activation baseline.
  if v_today >= (v_tracking_started_at at time zone 'Asia/Riyadh')::date + 14 then
    select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
      order by r.score desc, r.current_count desc, r.display_name asc), '[]'::jsonb)
    into v_improvement_leaders
    from (
      select p.display_name,
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
      order by score desc, current_count desc, p.display_name asc limit 3
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


    ) m
    where m.score > 0 and p.display_name is not null and btrim(p.display_name) <> ''
    order by m.score desc, p.display_name asc limit 3
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
    order by r.score desc, r.display_name asc), '[]'::jsonb)
  into v_consistency_leaders
  from (
    select p.display_name, count(*)::integer score
    from public.student_learning_days d
    join public.student_profiles p on p.user_id = d.user_id
    where d.activity_day between v_today - 6 and v_today
      and p.display_name is not null and btrim(p.display_name) <> ''
    group by p.user_id, p.display_name
    order by score desc, p.display_name asc limit 3
  ) r;

  -- Compare equal-length elapsed periods only after a complete post-activation baseline.
  if v_today >= (v_tracking_started_at at time zone 'Asia/Riyadh')::date + 14 then
    select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'score', r.score)
      order by r.score desc, r.current_count desc, r.display_name asc), '[]'::jsonb)
    into v_improvement_leaders
    from (
      select p.display_name,
        (count(*) filter (where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today)
         - count(*) filter (where (e.mastered_at at time zone 'Asia/Riyadh')::date
           between v_week_start - 7 and v_week_start - 7 + v_elapsed_days))::integer score,
        count(*) filter (where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today)::integer current_count
      from public.student_mastery_events e
      join public.student_profiles p on p.user_id = e.user_id
      where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start - 7 and v_today
        and p.display_name is not null and btrim(p.display_name) <> ''
      group by p.user_id, p.display_name
      having count(*) filter (where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today)
        > count(*) filter (where (e.mastered_at at time zone 'Asia/Riyadh')::date
          between v_week_start - 7 and v_week_start - 7 + v_elapsed_days)
      order by score desc, current_count desc, p.display_name asc limit 3
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


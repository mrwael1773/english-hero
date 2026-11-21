-- Student champions leaderboard: minimal event data, owner-scoped writes, aggregate-only reads.
-- This migration is additive and does not alter existing student balances or progress.
create table if not exists public.student_learning_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_day date not null,
  first_activity_at timestamptz not null default now(),
  primary key (user_id, activity_day)
);
alter table public.student_learning_days enable row level security;
alter table public.student_learning_days force row level security;
revoke all on table public.student_learning_days from public, anon, authenticated;

create table if not exists public.student_mastery_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_index integer not null check (lesson_index between 0 and 99),
  mastered_at timestamptz not null default now(),
  primary key (user_id, lesson_index)
);
alter table public.student_mastery_events enable row level security;
alter table public.student_mastery_events force row level security;
revoke all on table public.student_mastery_events from public, anon, authenticated;

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
  v_now timestamptz := clock_timestamp();
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
  if p_lesson_index is not null and p_lesson_index not between 0 and 99 then
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
revoke all on function public.record_student_learning_activity(text, integer, integer) from public, anon;
grant execute on function public.record_student_learning_activity(text, integer, integer) to authenticated;

create or replace function public.get_student_champions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_today date := (clock_timestamp() at time zone 'Asia/Riyadh')::date;
  v_week_start date;
  v_today_leaders jsonb;
  v_week_leaders jsonb;
  v_mastery_leaders jsonb;
  v_consistency_leaders jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Saudi school week: Sunday through Saturday.
  v_week_start := v_today - extract(dow from v_today)::integer;

  select coalesce(jsonb_agg(jsonb_build_object(
    'display_name', ranked.display_name, 'score', ranked.score
  ) order by ranked.score desc, ranked.first_at asc, ranked.display_name asc), '[]'::jsonb)
  into v_today_leaders
  from (
    select p.display_name, count(*)::integer as score, min(e.mastered_at) as first_at
    from public.student_mastery_events as e
    join public.student_profiles as p on p.user_id = e.user_id
    where (e.mastered_at at time zone 'Asia/Riyadh')::date = v_today
    group by p.user_id, p.display_name
    order by score desc, first_at asc, p.display_name asc
    limit 3
  ) as ranked;

  select coalesce(jsonb_agg(jsonb_build_object(
    'display_name', ranked.display_name, 'score', ranked.score
  ) order by ranked.score desc, ranked.first_at asc, ranked.display_name asc), '[]'::jsonb)
  into v_week_leaders
  from (
    select p.display_name, count(*)::integer as score, min(e.mastered_at) as first_at
    from public.student_mastery_events as e
    join public.student_profiles as p on p.user_id = e.user_id
    where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today
    group by p.user_id, p.display_name
    order by score desc, first_at asc, p.display_name asc
    limit 3
  ) as ranked;

  select coalesce(jsonb_agg(jsonb_build_object(
    'display_name', ranked.display_name, 'score', ranked.score
  ) order by ranked.score desc, ranked.display_name asc), '[]'::jsonb)
  into v_mastery_leaders
  from (
    select p.display_name,
      case when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
        then jsonb_array_length(lp.progress->'masteredLessons') else 0 end as score
    from public.student_profiles as p
    left join public.learning_progress as lp on lp.user_id = p.user_id
    where case when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
      then jsonb_array_length(lp.progress->'masteredLessons') else 0 end > 0
    order by score desc, p.display_name asc
    limit 3
  ) as ranked;

  select coalesce(jsonb_agg(jsonb_build_object(
    'display_name', ranked.display_name, 'score', ranked.score
  ) order by ranked.score desc, ranked.display_name asc), '[]'::jsonb)
  into v_consistency_leaders
  from (
    select p.display_name, count(*)::integer as score
    from public.student_learning_days as d
    join public.student_profiles as p on p.user_id = d.user_id
    where d.activity_day between v_today - 6 and v_today
    group by p.user_id, p.display_name
    order by score desc, p.display_name asc
    limit 3
  ) as ranked;

  return jsonb_build_object(
    'generated_at', v_now,
    'timezone', 'Asia/Riyadh',
    'week_start', v_week_start,
    'today', v_today,
    'today_leaders', v_today_leaders,
    'week_leaders', v_week_leaders,
    'mastery_leaders', v_mastery_leaders,
    'consistency_leaders', v_consistency_leaders
  );
end;
$$;
revoke all on function public.get_student_champions() from public, anon;
grant execute on function public.get_student_champions() to authenticated;

comment on table public.student_learning_days is
  'One minimal activity marker per authenticated student per Saudi calendar day; no answer or device data.';
comment on table public.student_mastery_events is
  'One timestamped event per authenticated student and mastered lesson; used for daily and weekly champion aggregates.';
comment on function public.get_student_champions() is
  'Returns only display names and aggregate leaderboard scores; never returns user IDs, usernames, emails, or raw progress.';

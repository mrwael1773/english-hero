-- Fair week-over-week improvement ranking.
-- The comparison uses equal elapsed Saudi calendar days and stays hidden until a full
-- post-activation comparison window is available.
create table if not exists public.student_champions_config (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null default now()
);
insert into public.student_champions_config(singleton) values (true)
on conflict (singleton) do nothing;
alter table public.student_champions_config enable row level security;
alter table public.student_champions_config force row level security;
revoke all on table public.student_champions_config from public, anon, authenticated;

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

  -- Saudi school week: Sunday through Saturday.
  v_elapsed_days := extract(dow from v_today)::integer;
  v_week_start := v_today - v_elapsed_days;
  select activated_at into v_tracking_started_at
  from public.student_champions_config
  where singleton = true;
  if not found then
    v_tracking_started_at := v_now;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'display_name', ranked.display_name, 'score', ranked.score
  ) order by ranked.score desc, ranked.first_at asc, ranked.display_name asc), '[]'::jsonb)
  into v_today_leaders
  from (
    select p.display_name, count(*)::integer as score, min(e.mastered_at) as first_at
    from public.student_mastery_events as e
    join public.student_profiles as p on p.user_id = e.user_id
    where (e.mastered_at at time zone 'Asia/Riyadh')::date = v_today
      and p.display_name is not null and btrim(p.display_name) <> ''
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
      and p.display_name is not null and btrim(p.display_name) <> ''
    group by p.user_id, p.display_name
    order by score desc, first_at asc, p.display_name asc
    limit 3
  ) as ranked;

  -- Count unique valid lesson indices, not raw array length.
  select coalesce(jsonb_agg(jsonb_build_object(
    'display_name', ranked.display_name, 'score', ranked.score
  ) order by ranked.score desc, ranked.display_name asc), '[]'::jsonb)
  into v_mastery_leaders
  from (
    select p.display_name, mastery.score
    from public.student_profiles as p
    left join public.learning_progress as lp on lp.user_id = p.user_id
    cross join lateral (
      select count(distinct item.value)::integer as score
      from jsonb_array_elements_text(
        case when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
          then lp.progress->'masteredLessons' else '[]'::jsonb end
      ) as item(value)
      where item.value ~ '^(0|[1-9]|[1-9][0-9])$'
    ) as mastery
    where mastery.score > 0
      and p.display_name is not null and btrim(p.display_name) <> ''
    order by mastery.score desc, p.display_name asc
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
      and p.display_name is not null and btrim(p.display_name) <> ''
    group by p.user_id, p.display_name
    order by score desc, p.display_name asc
    limit 3
  ) as ranked;

  -- Compare equal elapsed periods only after a complete post-activation baseline exists.
  if v_today >= (v_tracking_started_at at time zone 'Asia/Riyadh')::date + 14 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'display_name', ranked.display_name, 'score', ranked.score
    ) order by ranked.score desc, ranked.current_count desc, ranked.display_name asc), '[]'::jsonb)
    into v_improvement_leaders
    from (
      select p.display_name,
        (
          count(*) filter (
            where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today
          ) - count(*) filter (
            where (e.mastered_at at time zone 'Asia/Riyadh')::date
              between v_week_start - 7 and v_week_start - 7 + v_elapsed_days
          )
        )::integer as score,
        count(*) filter (
          where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today
        )::integer as current_count
      from public.student_mastery_events as e
      join public.student_profiles as p on p.user_id = e.user_id
      where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start - 7 and v_today
        and p.display_name is not null and btrim(p.display_name) <> ''
      group by p.user_id, p.display_name
      having count(*) filter (
        where (e.mastered_at at time zone 'Asia/Riyadh')::date between v_week_start and v_today
      ) > count(*) filter (
        where (e.mastered_at at time zone 'Asia/Riyadh')::date
          between v_week_start - 7 and v_week_start - 7 + v_elapsed_days
      )
      order by score desc, current_count desc, p.display_name asc
      limit 3
    ) as ranked;
  end if;

  return jsonb_build_object(
    'generated_at', v_now,
    'timezone', 'Asia/Riyadh',
    'week_start', v_week_start,
    'today', v_today,
    'today_leaders', v_today_leaders,
    'week_leaders', v_week_leaders,
    'mastery_leaders', v_mastery_leaders,
    'consistency_leaders', v_consistency_leaders,
    'improvement_leaders', v_improvement_leaders
  );
end;
$$;

revoke all on function public.get_student_champions() from public, anon;
grant execute on function public.get_student_champions() to authenticated;

comment on function public.get_student_champions() is
  'Returns display names and aggregate scores only, including week-over-week mastery improvement; no user IDs, usernames, emails, or raw progress.';

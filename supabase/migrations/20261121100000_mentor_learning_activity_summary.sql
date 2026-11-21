-- Add a minimal, latest-only learning activity marker for the mentor dashboard.
-- No answer content, IP address, device fingerprint, or free-form student text is stored.
alter table public.student_activity
  add column if not exists last_learning_action text
    check (last_learning_action in (
      'lesson_started',
      'lesson_progress',
      'lesson_training_completed',
      'lesson_assessment_attempted',
      'lesson_mastered',
      'quiz_completed'
    )),
  add column if not exists last_learning_activity_at timestamptz,
  add column if not exists last_learning_lesson_index integer
    check (last_learning_lesson_index is null or last_learning_lesson_index between 0 and 99),
  add column if not exists last_learning_word_index integer
    check (last_learning_word_index is null or last_learning_word_index between 0 and 99),
  add column if not exists current_lesson_index integer
    check (current_lesson_index is null or current_lesson_index between 0 and 99),
  add column if not exists current_word_index integer
    check (current_word_index is null or current_word_index between 0 and 99);

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

  insert into public.student_activity (
    user_id,
    last_seen_at,
    last_learning_action,
    last_learning_activity_at,
    last_learning_lesson_index,
    last_learning_word_index,
    current_lesson_index,
    current_word_index
  )
  values (
    v_user_id,
    v_now,
    p_action,
    v_now,
    p_lesson_index,
    p_word_index,
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
          'xp', case when jsonb_typeof(lp.progress->'xp') = 'number' then lp.progress->'xp' else null end,
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
          'current_lesson_index', coalesce(a.current_lesson_index, active_lesson.lesson_index),
          'current_word_index', coalesce(
            a.current_word_index,
            case
              when (lp.progress->'lessonPositions'->>(coalesce(a.current_lesson_index, active_lesson.lesson_index)::text)) ~ '^[0-9]{1,2}
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
  left join lateral (
    select started.lesson_index
    from (
      select
        case
          when lesson_index_text ~ '^[0-9]{1,2}
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
  left join lateral (
    select started.lesson_index_text::integer as lesson_index
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(lp.progress->'lessonStarted') = 'array'
        then lp.progress->'lessonStarted'
        else '[]'::jsonb
      end
    ) with ordinality as started(lesson_index_text, ordinal)
    where started.lesson_index_text ~ '^[0-9]+$'
      and not (
        case
          when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
          then lp.progress->'masteredLessons'
          else '[]'::jsonb
        end @> jsonb_build_array(started.lesson_index_text::integer)
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
 then lesson_index_text::integer
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
  left join lateral (
    select started.lesson_index_text::integer as lesson_index
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(lp.progress->'lessonStarted') = 'array'
        then lp.progress->'lessonStarted'
        else '[]'::jsonb
      end
    ) with ordinality as started(lesson_index_text, ordinal)
    where started.lesson_index_text ~ '^[0-9]+$'
      and not (
        case
          when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
          then lp.progress->'masteredLessons'
          else '[]'::jsonb
        end @> jsonb_build_array(started.lesson_index_text::integer)
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

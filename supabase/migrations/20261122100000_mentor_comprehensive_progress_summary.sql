-- Expose only bounded, aggregate learning metrics to the mentor overview.
-- Never return answer text, saved vocabulary strings, chat history, usernames, or raw progress JSON.
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
            select coalesce(jsonb_agg(e.value::integer order by e.ordinality), '[]'::jsonb)
            from jsonb_array_elements_text(
              case when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
                then lp.progress->'masteredLessons' else '[]'::jsonb end
            ) with ordinality as e(value, ordinality)
            where e.value ~ '^(0|[1-9][0-9]?)
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
$$; and e.value::integer between 0 and 99
          ),
          'trained_indices', (
            select coalesce(jsonb_agg(e.value::integer order by e.ordinality), '[]'::jsonb)
            from jsonb_array_elements_text(
              case when jsonb_typeof(lp.progress->'lessonTrained') = 'array'
                then lp.progress->'lessonTrained' else '[]'::jsonb end
            ) with ordinality as e(value, ordinality)
            where e.value ~ '^(0|[1-9][0-9]?)
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
$$; and e.value::integer between 0 and 99
          ),
          'started_indices', (
            select coalesce(jsonb_agg(e.value::integer order by e.ordinality), '[]'::jsonb)
            from jsonb_array_elements_text(
              case when jsonb_typeof(lp.progress->'lessonStarted') = 'array'
                then lp.progress->'lessonStarted' else '[]'::jsonb end
            ) with ordinality as e(value, ordinality)
            where e.value ~ '^(0|[1-9][0-9]?)
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
$$; and e.value::integer between 0 and 99
          ),
          'saved_words_count', case when jsonb_typeof(lp.progress->'saved') = 'array'
            then jsonb_array_length(lp.progress->'saved') else 0 end,
          'foundation_saved_count', case when jsonb_typeof(lp.progress->'foundationSaved') = 'array'
            then jsonb_array_length(lp.progress->'foundationSaved') else 0 end,
          'review_words_count', (
            select count(*) from jsonb_each(
              case when jsonb_typeof(lp.progress->'review') = 'object'
                then lp.progress->'review' else '{}'::jsonb end
            )
          ),
          'review_due_count', (
            select count(*) from jsonb_each(
              case when jsonb_typeof(lp.progress->'review') = 'object'
                then lp.progress->'review' else '{}'::jsonb end
            ) as r(key, value)
            where jsonb_typeof(r.value) = 'object'
              and coalesce(r.value->>'due', '') ~ '^\\d{4}-\\d{2}-\\d{2}
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
              and (r.value->>'due')::date <= (now() at time zone 'Asia/Riyadh')::date
              and coalesce(r.value->>'stage', '') <> 'retained'
          ),
          'missed_words_count', (
            select count(*) from jsonb_each(
              case when jsonb_typeof(lp.progress->'misses') = 'object'
                then lp.progress->'misses' else '{}'::jsonb end
            ) as m(key, value)
            where value = 'true'::jsonb
          ),
          'quiz_attempts', case when jsonb_typeof(lp.progress->'quizHistory') = 'array'
            then jsonb_array_length(lp.progress->'quizHistory') else 0 end,
          'best_quiz_score', case
            when (lp.progress->>'best') ~ '^(0|[1-9][0-9]?)
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
              and (lp.progress->>'best')::integer <= 100
            then (lp.progress->>'best')::integer else null end,
          'answers_count', case
            when (lp.progress->'answerStats'->>'answered') ~ '^(0|[1-9][0-9]{0,8})
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
            then (lp.progress->'answerStats'->>'answered')::integer else 0 end,
          'correct_answers_count', case
            when (lp.progress->'answerStats'->>'correct') ~ '^(0|[1-9][0-9]{0,8})
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
            then (lp.progress->'answerStats'->>'correct')::integer else 0 end,
          'active_days_count', (
            select count(*) from jsonb_each(
              case when jsonb_typeof(lp.progress->'daily') = 'object'
                then lp.progress->'daily' else '{}'::jsonb end
            ) as d(day_key, tasks)
            where d.day_key ~ '^\\d{4}-\\d{2}-\\d{2}
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
              and jsonb_typeof(d.tasks) = 'object'
              and exists (
                select 1 from jsonb_each(d.tasks) as t(task_key, task_value)
                where t.task_value = 'true'::jsonb
              )
          ),
          'learning_streak', case
            when (lp.progress->>'streak') ~ '^(0|[1-9][0-9]{0,5})
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
            then (lp.progress->>'streak')::integer else 0 end,
          'vocab_level', case
            when jsonb_typeof(lp.progress->'vocabLevel') in ('string','number')
            then left(lp.progress->>'vocabLevel', 24) else null end,
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

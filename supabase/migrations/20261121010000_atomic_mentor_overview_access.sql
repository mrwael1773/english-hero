-- Make mentor-token validation, last-use tracking, and student summary retrieval atomic.
-- The Edge Function calls this RPC with the SHA-256 token hash; raw tokens never enter SQL.
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
        'username', p.username,
        'display_name', p.display_name,
        'last_seen_at', a.last_seen_at,
        'progress', jsonb_build_object(
          'xp', case when jsonb_typeof(lp.progress->'xp') = 'number' then lp.progress->'xp' else null end,
          'completed_count', case
            when jsonb_typeof(lp.progress->'completed') = 'array'
            then jsonb_array_length(lp.progress->'completed') else 0 end,
          'mastered_count', case
            when jsonb_typeof(lp.progress->'masteredLessons') = 'array'
            then jsonb_array_length(lp.progress->'masteredLessons') else 0 end
        )
      )
      order by p.display_name, p.username
    ),
    '[]'::jsonb
  )
  into v_students
  from public.student_profiles as p
  left join public.student_activity as a on a.user_id = p.user_id
  left join public.learning_progress as lp on lp.user_id = p.user_id;

  return jsonb_build_object(
    'students', v_students,
    'generated_at', v_now
  );
end;
$$;

revoke all on function public.mentor_get_student_overview(text) from public, anon, authenticated;
grant execute on function public.mentor_get_student_overview(text) to service_role;

comment on function public.mentor_get_student_overview(text) is
  'Atomically validates and locks a mentor bearer token, records last use, and returns a minimal student summary.';

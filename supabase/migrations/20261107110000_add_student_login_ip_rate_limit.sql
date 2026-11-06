-- Add a second, independent login throttle keyed by client IP.
-- The existing username+IP throttle remains in place (5 attempts / 15 minutes).
-- This additional bucket limits distributed username guessing from one address.
create or replace function private.consume_student_login_ip_attempt(p_attempt_key text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_attempts integer;
begin
  if p_attempt_key !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  insert into private.student_login_attempts as current_attempt(attempt_key, window_started_at, attempts)
  values (p_attempt_key, now(), 1)
  on conflict (attempt_key) do update
    set attempts = case
      when current_attempt.window_started_at < now() - interval '15 minutes' then 1
      else current_attempt.attempts + 1
    end,
    window_started_at = case
      when current_attempt.window_started_at < now() - interval '15 minutes' then now()
      else current_attempt.window_started_at
    end
  returning attempts into v_attempts;

  delete from private.student_login_attempts
  where window_started_at < now() - interval '1 day';

  return v_attempts <= 30;
end;
$$;

revoke all on function private.consume_student_login_ip_attempt(text) from public, anon, authenticated;
grant execute on function private.consume_student_login_ip_attempt(text) to service_role;

create or replace function public.consume_student_login_ip_attempt(p_attempt_key text)
returns boolean
language sql
security definer
set search_path = pg_catalog
as $$ select private.consume_student_login_ip_attempt(p_attempt_key); $$;

revoke all on function public.consume_student_login_ip_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_student_login_ip_attempt(text) to service_role;

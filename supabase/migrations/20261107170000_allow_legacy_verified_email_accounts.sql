-- Preserve pre-gateway verified email/password accounts during username onboarding.
-- The authenticated user can claim only their own profile (auth.uid()).
-- Accounts created on/after the gateway cutover still require Google identity.
-- This fixed cutoff is intentionally immutable; do not move it forward.

create or replace function public.claim_student_username(
  p_username text,
  p_display_name text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_display_name text := trim(coalesce(p_display_name, ''));
  v_email_confirmed_at timestamptz;
  v_has_google_identity boolean := false;
  v_is_legacy_account boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Invalid username' using errcode = '22023';
  end if;
  if char_length(v_display_name) not between 1 and 48 then
    raise exception 'Invalid display name' using errcode = '22023';
  end if;

  select
    email_confirmed_at,
    coalesce(raw_app_meta_data->>'provider' = 'google', false)
      or coalesce(raw_app_meta_data->'providers', '[]'::jsonb) ? 'google',
    created_at < timestamptz '2026-11-07 00:00:00+00'
  into v_email_confirmed_at, v_has_google_identity, v_is_legacy_account
  from auth.users
  where id = v_user_id;

  if v_email_confirmed_at is null then
    raise exception 'A verified email is required' using errcode = '42501';
  end if;
  if not coalesce(v_has_google_identity, false)
     and not coalesce(v_is_legacy_account, false) then
    raise exception 'A verified Google identity is required for new accounts' using errcode = '42501';
  end if;

  insert into public.student_profiles(user_id, username, display_name)
  values (v_user_id, v_username, v_display_name)
  on conflict (user_id) do update
    set username = excluded.username,
        display_name = excluded.display_name,
        updated_at = now();

  insert into private.student_login_lookup(user_id, username)
  values (v_user_id, v_username)
  on conflict (user_id) do update
    set username = excluded.username;

  return jsonb_build_object('username', v_username, 'display_name', v_display_name);
end;
$$;

-- Keep the existing narrow authenticated-only execution grant.
revoke all on function public.claim_student_username(text, text) from public, anon;
grant execute on function public.claim_student_username(text, text) to authenticated;

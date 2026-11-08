-- Student onboarding must originate from a verified Google identity.
-- Username/password sign-in is enabled only after a Google-authenticated account
-- has completed onboarding and set its password in Supabase Auth.
-- Keep this SECURITY DEFINER RPC narrowly scoped: it derives the owner from auth.uid(),
-- requires a verified email and a Google identity, and writes only that user's profile.

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
      or coalesce(raw_app_meta_data->'providers', '[]'::jsonb) ? 'google'
  into v_email_confirmed_at, v_has_google_identity
  from auth.users
  where id = v_user_id;

  if v_email_confirmed_at is null then
    raise exception 'A verified email is required' using errcode = '42501';
  end if;
  if not coalesce(v_has_google_identity, false) then
    raise exception 'A verified Google identity is required' using errcode = '42501';
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

-- Preserve the existing, intentionally authenticated-only RPC grant.
revoke all on function public.claim_student_username(text, text) from public, anon;
grant execute on function public.claim_student_username(text, text) to authenticated;

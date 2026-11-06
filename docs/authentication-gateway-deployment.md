# Authentication gateway deployment checklist

This change is intentionally prepared for review only. Do not deploy it to the school pilot until every check below is complete.

## 1. Supabase database

1. Review and apply `supabase/migrations/20261106130000_student_username_auth_foundation.sql` to an isolated Supabase project first.
2. Apply `supabase/migrations/20261106140000_learning_progress_owner_scope.sql` after the username-auth foundation migration. The gateway waits for `public.learning_progress`; without this table, authenticated students remain locked out when the initial cloud sync fails.
3. Verify that `public.student_profiles` and `public.learning_progress` both have RLS and FORCE RLS enabled. Confirm that each authenticated user can read their own profile and read/write only their own progress row.
4. Verify that `private.student_login_lookup` and `private.student_login_attempts` are not exposed through the Data API. The lookup stores only the Auth user ID and username; the current email is retrieved from Supabase Auth during login.
5. Verify that only `service_role` can execute the two public wrapper RPCs used by the Edge Function.
6. Verify that `claim_student_username` is executable only by authenticated users and cannot claim a profile for another user.
7. Apply `supabase/migrations/20261106150000_require_google_identity_for_student_profiles.sql` after the progress migration. Verify that onboarding rejects a verified email/password-only account and accepts a verified Google identity. The `SECURITY DEFINER` advisor warning is expected for this narrowly scoped RPC; retain the `auth.uid()` ownership check, verified-email and Google-provider checks, and fixed `search_path`.
7. Test progress isolation with two separate test accounts: account A must not read or modify account B's row, including through direct PostgREST requests.

## 2. Google OAuth

1. Enable Google as an Auth provider in Supabase.
2. Configure the Google OAuth client credentials in Supabase Auth.
3. Add the exact production callback URL shown by Supabase to the Google OAuth client.
4. Add the deployed site origin and callback path to Supabase Auth redirect allow-list.
5. Test both a new Google account and an existing Google account that already owns a `learning_progress` row. Confirm the existing account keeps the same Auth user ID and progress.

## 3. Username login Edge Function

1. Deploy `student-username-login` from `supabase/functions/student-username-login/index.ts`.
2. Configure the function with Supabase's server-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` environment values. Never copy the service-role key into this repository or browser configuration.
3. Keep JWT verification disabled only for this explicit unauthenticated login endpoint; the function validates the username/password through Supabase Auth and applies its own rate limit.
4. Keep `ENGLISH_HERO_ALLOWED_ORIGIN` set to the exact deployed origin if the deployment environment requires overriding the default.
5. Test invalid username, invalid password, rate limiting, valid login, and CORS rejection from an unapproved origin.

## 4. Browser and student-data checks

- Test login, Google OAuth callback, onboarding, password confirmation, duplicate username, sign-out, and return-to-gateway behavior.
- Test account switching on a shared device and confirm no student's local or cloud progress is shown to another account. Unclaimed progress with no account-owner marker must be backed up separately and never merged into a newly signed-in student's account.
- Test at 320px mobile width and a desktop viewport.
- Confirm privacy/contact/school-pilot pages remain accessible without a student account.
- Confirm the service worker refreshes the new gateway assets and does not serve stale authentication code.
- Review Supabase Auth rate limits and leaked-password protection settings. Do not change production settings without approval.

## Current limitation

GitHub browser tests mock the cloud-auth boundary. They validate gateway navigation and local UI behavior, not real Google OAuth, production database policies, or the deployed Edge Function. A successful CI run is not sufficient evidence of school readiness.

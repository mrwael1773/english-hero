# Authentication gateway deployment checklist

This change is intentionally prepared for review only. Do not deploy it to the school pilot until every check below is complete.

## 1. Supabase database

1. Check migration history before applying anything. If `student_username_auth_foundation` is already recorded, compare its stored SQL with `supabase/migrations/20261106110025_student_username_auth_foundation.sql`; the migration version and name must match the repository file. A different timestamp alone does not mean the migration is missing. Never edit migration history manually or replay an already-applied foundation migration.
2. Apply `supabase/migrations/20261106110025_student_username_auth_foundation.sql` only if it is not already recorded and its objects are absent. Preserve every existing Auth user ID and learning-progress row.
3. Apply `supabase/migrations/20261106143509_learning_progress_owner_scope.sql` only if the table and its owner-scoped policies are not already present. The gateway waits for `public.learning_progress`; without this table, authenticated students remain locked out when the initial cloud sync fails.
4. Enable the Data API and include the `public` schema in **Integrations > Data API**. The Data API exposes schemas, not individual tables. This client requires `public.student_profiles` for profile lookup and `public.learning_progress` for progress sync. Keep grants least-privilege: authenticated users need SELECT on `student_profiles` and SELECT/INSERT/UPDATE on `learning_progress`; `anon` must have no table privileges. Do not expose the `private` schema. Re-audit grants whenever another object is added to `public`.
5. Verify that `public.student_profiles` and `public.learning_progress` both have RLS and FORCE RLS enabled. Confirm that each authenticated user can read their own profile and read/write only their own progress row.
6. Verify that `private.student_login_lookup` and `private.student_login_attempts` are not exposed through the Data API and that `anon` and `authenticated` have no USAGE on the `private` schema. The lookup stores only the Auth user ID and username; the current email is retrieved from Supabase Auth during login.
7. Verify that only `service_role` can execute the four public wrapper RPCs used by the Edge Function: username+IP attempt consumption, username-only attempt consumption, IP-only attempt consumption, and username-to-user lookup.
8. Verify that `claim_student_username` is executable only by authenticated users and cannot claim a profile for another user.
9. Apply `supabase/migrations/20261106143515_require_google_identity_for_student_profiles.sql` after the progress migration. Verify that onboarding rejects a verified email/password-only account and accepts a verified Google identity. The `SECURITY DEFINER` advisor warning is expected for this narrowly scoped RPC; retain the `auth.uid()` ownership check, verified-email and Google-provider checks, and fixed `search_path`.
10. Apply `supabase/migrations/20261106145142_optimize_student_rls_auth_uid.sql` after the owner-scoped policies. It should preserve the same ownership checks while evaluating `auth.uid()` once per statement.
11. Apply `supabase/migrations/20261106150755_revoke_public_default_api_grants.sql` to prevent objects created by the `postgres` role in `public` from automatically granting table, function, or sequence access to `anon`, `authenticated`, or `service_role`. This changes defaults for future objects only; existing explicit grants remain unchanged. Keep app-owned schema changes under `postgres` and grant each required role explicitly.
12. Apply `supabase/migrations/20261106151031_revoke_global_public_function_execute.sql` to revoke PostgreSQL's global default `PUBLIC EXECUTE` grant from future functions created by the app-owned `postgres` role. This is global for functions created by that role, so explicitly grant execution to any client role that genuinely needs it. Do not alter Supabase-managed `supabase_admin` defaults.
13. Apply `supabase/migrations/20261107110000_add_student_login_ip_rate_limit.sql` to add independent 15-minute buckets: 5 attempts per username, 5 attempts per username+IP, and 30 attempts per IP. Verify all new wrappers are executable only by `service_role`.
14. Test progress isolation with two separate test accounts: account A must not read or modify account B's row, including through direct PostgREST requests.
15. Apply `supabase/migrations/20261107120000_force_rls_on_private_auth_tables.sql` and verify FORCE RLS is enabled on both private login tables. Confirm `anon` and `authenticated` still have no table privileges or schema usage, while the Edge Function's service role retains the required access.

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

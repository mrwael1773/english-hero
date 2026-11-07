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

## 1A. Live production audit snapshot (read-only, 7 November 2026)

The connected production project `cajevfsdhtbhtzcphbsz` was inspected without changing its schema or data. Its migration history contains the four school-pilot migrations through `20261102203921`, but does **not** contain the eight student-username authentication migrations listed above. The production database currently has `public.learning_progress` and `public.teacher_pilot_results`, but does not have `public.student_profiles`, `private.student_login_lookup`, or `private.student_login_attempts`. The active production Edge Function list contains `english-coach` only; `student-username-login` is active only in the separate test project.

**Release consequence:** the PR branch's browser configuration still targets the production Supabase project. If the gateway code is published before the reviewed authentication migrations and Edge Function are deployed, profile lookup/onboarding and username login cannot work against production. The gateway currently fails closed on profile lookup errors, which protects learning screens but leaves students unable to proceed. Do not merge/publish this authentication gateway until the production schema, function, OAuth settings, and redirect allow-list are deliberately prepared and verified.

The production audit also found:
- `public.learning_progress` has owner-scoped authenticated SELECT/INSERT/UPDATE policies.
- `public.teacher_pilot_results` has authenticated owner-only CRUD policies and authenticated INSERT/UPDATE/DELETE grants. Despite policy names containing “Teachers”, no teacher role is checked: **any authenticated account can create, edit, or delete its own result row**. These rows are therefore self-submitted and must not be treated as verified teacher assessments or official school results. Before using this table for school reporting, remove direct student write access and move result entry behind a server-enforced teacher role with auditable teacher-to-class/student authorization. No production permissions were changed during this audit.
- Legacy `public.student_progress` and `public.analytics_events` have RLS enabled but no policies. The inspected grants show no anon/authenticated table privileges; the service role retains access where applicable. Treat these as locked legacy/administrative tables, not as usable student or teacher APIs. Do not add broad policies just to silence the advisor.
- The production security advisor reports leaked-password protection disabled. Review and enable it in Supabase Auth settings before school use, after confirming its impact on the chosen student password policy.
- The production performance advisor returned no findings.

The separate test project `knjcyuvhaoievxkzcdog` has the eight username-auth migrations, owner-scoped progress/profile policies, and active `student-username-login` Edge Function version 2. On 7 November 2026, the test function was updated from version 1 because its deployed code lagged behind the repository; version 2 was then re-read and verified byte-for-byte against the branch source, with the independent username, username+IP, and IP rate-limit checks present. It is a test environment only; its successful schema checks do not prepare production automatically. **Migration-history reconciliation:** the test project's recorded versions for `add_student_login_ip_rate_limit` and `force_rls_on_private_auth_tables` are `20261106221407` and `20261106221609`, while the current repository filenames use `20261107110000` and `20261107120000`. Read-only verification on 7 November confirmed that the test database's private IP/username throttle function definitions match the current SQL files, both private auth tables have RLS and FORCE RLS enabled, and only `service_role` can execute the private/public throttle functions; `anon` and `authenticated` have no `private` schema USAGE. Do **not** replay either migration on the test project or edit its migration history to force the timestamps to match. Before any future migration is applied there, reconcile the checked-in files with the already-applied SQL and recorded versions in a reviewed migration-history change. Production has neither migration recorded, so its deployment must be handled separately using its own migration history and preflight checks. Its Security Advisor currently reports two informational `rls_enabled_no_policy` findings for the private login tables; these are intentional only while `anon`/`authenticated` have no private-schema usage or table grants and FORCE RLS remains enabled. Do not add client policies to silence this notice. The `claim_student_username` SECURITY DEFINER warning is also expected only while its ownership, verified-Google-identity, and fixed-search-path checks remain intact.

## 2. Google OAuth

1. Enable Google as an Auth provider in Supabase.
2. Configure the Google OAuth client credentials in Supabase Auth.
3. Add the exact production callback URL shown by Supabase to the Google OAuth client.
4. Add the deployed site origin and callback path to Supabase Auth redirect allow-list.
5. Test both a new Google account and an existing Google account that already owns a `learning_progress` row. Confirm the existing account keeps the same Auth user ID and progress.

### Test-project OAuth preflight (read-only, 7 November 2026)

The separate test project `knjcyuvhaoievxkzcdog` was checked without changing provider settings or creating an Auth user:
- The public Auth settings endpoint reports `external.providers.google = true`.
- A direct authorization-start request using `provider=google` and `redirect_to=https://mrwael1773.github.io/english-hero/` successfully redirected to `accounts.google.com`. Supabase accepted the requested redirect and began the Google authorization flow; no `provider disabled`, missing OAuth client, or redirect-not-allowed error was returned.
- This is only an OAuth-start/configuration smoke test. No Google account was authenticated, no callback/session was completed, no profile was claimed, and no learning-progress row was read or written. The currently deployed GitHub Pages site still uses the production Supabase configuration; this test did not switch it to the test project.
- A full end-to-end Google sign-in still requires a dedicated test Google identity and a browser session signed into that identity. Do not use a student's or an unrelated personal Google account for this test.

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

## Additional school-release blockers

- **Teacher pilot page:** `teacher-pilot.html` is a public, static training demonstration, not a teacher dashboard and not a teacher-authenticated route. Its temporary tab-scoped session state is not an account, identity check, or official student record. Keep it limited to synthetic/demo data; do not enter names, grades, class lists, or identifiable student information. The `noindex` metadata is not access control.
- **Teacher access:** this release has no trusted teacher role, teacher provisioning flow, or teacher-specific RLS policies. Do not give teachers student accounts or infer teacher permissions from a client-editable profile field. Design and independently review server-controlled role assignment, least-privilege teacher queries, audit logging, and cross-class/student isolation before enabling teacher access.
- **Static lesson files:** the gateway and route guard are browser-side navigation controls. GitHub Pages still serves static HTML files directly, so they are not confidential resources and must not contain student records, answer keys intended to be private, or privileged teacher content. If lesson confidentiality is required, move protected content behind a server-enforced authorization boundary.
- **Account recovery:** username/password login currently has no verified student recovery workflow. Keep the pilot blocked until recovery is designed around the verified Google identity or another school-approved process, with rate limits and tests that prevent account takeover and cross-account recovery.
- **Shared-device data:** local account backups may contain the last 60 chat messages. Sign-out/account switching preserves a local backup; this is disclosed in the privacy policy. Define and test a school-device cleanup procedure before shared-device use.
- **Login IP rate-limit trust boundary:** `student-username-login` currently prefers `cf-connecting-ip` and falls back to the right-most `x-forwarded-for` value. Cloudflare documents how it sets/appends these headers at its own edge, but that alone does not establish Supabase's complete managed-ingress contract for every Edge Function route. Do not treat the fallback as a verified client identity or rely on per-IP throttling as a security boundary until Supabase confirms the exact header sanitization/append behavior for this project's hosted function endpoint (including missing/duplicate headers and any alternate route), or a controlled test-project verification establishes it. Keep username and username+IP throttles as independent layers; CORS is not authentication and does not prevent non-browser callers.

## Current limitation

GitHub browser tests mock the cloud-auth boundary. They validate gateway navigation and local UI behavior, not real Google OAuth, production database policies, or the deployed Edge Function. A successful CI run is not sufficient evidence of school readiness.

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
9. Apply `supabase/migrations/20261106143515_require_google_identity_for_student_profiles.sql` after the progress migration. Verify that onboarding rejects post-cutover email/password-only accounts and accepts verified Google identities. A pre-cutover email/password account may claim a student profile only when its email is verified and it already owns a `learning_progress` row. The `SECURITY DEFINER` advisor warning is expected for this narrowly scoped RPC; retain the `auth.uid()` ownership check, verified-email and Google-provider checks, and fixed `search_path`.
10. Apply `supabase/migrations/20261106145142_optimize_student_rls_auth_uid.sql` after the owner-scoped policies. It should preserve the same ownership checks while evaluating `auth.uid()` once per statement.
11. Apply `supabase/migrations/20261106150755_revoke_public_default_api_grants.sql` to prevent objects created by the `postgres` role in `public` from automatically granting table, function, or sequence access to `anon`, `authenticated`, or `service_role`. This changes defaults for future objects only; existing explicit grants remain unchanged. Keep app-owned schema changes under `postgres` and grant each required role explicitly.
12. Apply `supabase/migrations/20261106151031_revoke_global_public_function_execute.sql` to revoke PostgreSQL's global default `PUBLIC EXECUTE` grant from future functions created by the app-owned `postgres` role. This is global for functions created by that role, so explicitly grant execution to any client role that genuinely needs it. Do not alter Supabase-managed `supabase_admin` defaults.
13. Apply `supabase/migrations/20261107110000_add_student_login_ip_rate_limit.sql` to add independent 15-minute buckets: 5 attempts per username, 5 attempts per username+IP, and 30 attempts per IP. Verify all new wrappers are executable only by `service_role`.
14. Test progress isolation with two separate test accounts: account A must not read or modify account B's row, including through direct PostgREST requests.
15. Apply `supabase/migrations/20261107120000_force_rls_on_private_auth_tables.sql` and verify FORCE RLS is enabled on both private login tables. Confirm `anon` and `authenticated` still have no table privileges or schema usage, while the Edge Function's service role retains the required access.

## 1A. Live production audit snapshot (read-only, 7 November 2026)

The connected production project `cajevfsdhtbhtzcphbsz` was inspected without changing its schema or data in this initial audit snapshot (before the later fail-closed teacher-results permission change described in the follow-up note). Its migration history contains the four school-pilot migrations through `20261102203921`, but does **not** contain the eight student-username authentication migrations listed above. The production database currently has `public.learning_progress` and `public.teacher_pilot_results`, but does not have `public.student_profiles`, `private.student_login_lookup`, or `private.student_login_attempts`. The active production Edge Function list contains `english-coach` only; `student-username-login` is active only in the separate test project.

**Release consequence:** the PR branch's browser configuration still targets the production Supabase project. If the gateway code is published before the reviewed authentication migrations and Edge Function are deployed, profile lookup/onboarding and username login cannot work against production. The gateway currently fails closed on profile lookup errors, which protects learning screens but leaves students unable to proceed. Do not merge/publish this authentication gateway until the production schema, function, OAuth settings, and redirect allow-list are deliberately prepared and verified.

The production audit also found:
- `public.learning_progress` has owner-scoped authenticated SELECT/INSERT/UPDATE policies.
- `public.teacher_pilot_results` has authenticated owner-only CRUD policies and authenticated INSERT/UPDATE/DELETE grants. Despite policy names containing “Teachers”, no teacher role is checked: **any authenticated account can create, edit, or delete its own result row**. These rows are therefore self-submitted and must not be treated as verified teacher assessments or official school results. Before using this table for school reporting, remove direct student write access and move result entry behind a server-enforced teacher role with auditable teacher-to-class/student authorization. No production permissions were changed during this audit.
- Legacy `public.student_progress` and `public.analytics_events` have RLS enabled but no policies. The inspected grants show no anon/authenticated table privileges; the service role retains access where applicable. Treat these as locked legacy/administrative tables, not as usable student or teacher APIs. Do not add broad policies just to silence the advisor.
- The production security advisor reports leaked-password protection disabled. Review and enable it in Supabase Auth settings before school use, after confirming its impact on the chosen student password policy.
- The production performance advisor returned no findings.

The separate test project `knjcyuvhaoievxkzcdog` has the eight username-auth migrations, owner-scoped progress/profile policies, and active student-username-login Edge Function version 4. Version 4 was deployed from the current branch and re-read; its source matches the repository byte-for-byte. Username throttling is mandatory. IP throttling is optional defense-in-depth and uses only the optional edge cf-connecting-ip header; client-supplied x-forwarded-for is ignored. Missing IP metadata does not block sign-in. The test project also has the fail-closed teacher-results permissions migration; a test-only fixture migration created the empty teacher-results table to mirror production before the permission migration was applied. It is a test environment only; its successful schema checks do not prepare production automatically. **Migration-history reconciliation:** the test project's recorded versions for `add_student_login_ip_rate_limit` and `force_rls_on_private_auth_tables` are `20261106221407` and `20261106221609`, while the current repository filenames use `20261107110000` and `20261107120000`. Read-only verification on 7 November confirmed that the test database's private IP/username throttle function definitions match the current SQL files, both private auth tables have RLS and FORCE RLS enabled, and only `service_role` can execute the private/public throttle functions; `anon` and `authenticated` have no `private` schema USAGE. Do **not** replay either migration on the test project or edit its migration history to force the timestamps to match. Before any future migration is applied there, reconcile the checked-in files with the already-applied SQL and recorded versions in a reviewed migration-history change. At the time of this initial snapshot, production had neither migration recorded. The follow-up production application and tool-generated migration versions are documented below; do not replay the development-timestamp files blindly. Its Security Advisor currently reports two informational `rls_enabled_no_policy` findings for the private login tables; these are intentional only while `anon`/`authenticated` have no private-schema usage or table grants and FORCE RLS remains enabled. Do not add client policies to silence this notice. The `claim_student_username` SECURITY DEFINER warning is also expected only while its ownership, verified-Google-identity, and fixed-search-path checks remain intact.

### Follow-up production permission change (7 November 2026)

After the initial read-only snapshot above, the production `teacher_pilot_results` table was secured with migration `20261107150000_disable_unverified_teacher_pilot_client_access`: FORCE RLS was enabled, the misleading owner-only client policies were removed, and direct table privileges were revoked from PUBLIC, anon, and authenticated. Existing rows were preserved. This is a deferred teacher feature and is not a student-release blocker; do not restore client access.

### Production student-auth backend preparation (7 November 2026)

The student-auth database foundation and username-login Edge Function have now been prepared on the production Supabase project without creating or modifying student Auth accounts:

- Applied the student username/profile foundation, owner-scoped progress policy, verified-Google identity check, RLS policy optimization, default-privilege hardening, username/IP rate-limit functions, and FORCE RLS for private auth tables.
- Deployed `student-username-login` as ACTIVE version 1 with `verify_jwt=false`; the deployed `index.ts` was re-read and matched the branch source byte-for-byte (5,549 characters). The function validates username/password itself, uses service-role-only RPCs, enforces username throttling, and treats the Cloudflare IP header as optional secondary throttling only. It does not trust client-supplied `X-Forwarded-For`.
- Verified FORCE RLS on `student_profiles`, `learning_progress`, `private.student_login_lookup`, `private.student_login_attempts`, and the deferred `teacher_pilot_results` table. The private auth tables have no ordinary client grants; only the service role has the required table access.
- Verified that `claim_student_username` is executable by authenticated users only, uses `SECURITY DEFINER` with fixed `search_path=pg_catalog`, and derives the account owner from `auth.uid()`; it also enforces verified Google identity.
- Verified that `learning_progress` still contains its original 3 rows. No Auth users were created, no progress rows were deleted or rewritten, and the teacher results table remains closed to ordinary clients.

**Migration-history reconciliation warning:** Supabase recorded these production migrations under tool-generated versions `20261107123333` through `20261107123407`, while the checked-in branch filenames use the original development timestamps. The earlier teacher-results permission migration is recorded in production as `20261107121712`, while the branch filename is `20261107150000`. The test project also has its own earlier recorded versions. Do not run `supabase db push` or replay migrations blindly. Reconcile the per-environment migration history with the checked-in SQL before a future CLI deployment; the production schema itself has been applied and independently inspected.

Remaining live gates: production Google provider/client configuration and callback flow, recovery email delivery/redirect allow-list and a real recovery session, leaked-password protection, Data API exposed-schema confirmation, and real login attempts from the deployed public site. No real student account was used.

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

## Mastery-state consistency — required before school pilot

A source audit found a concrete inconsistency in the current lesson retake flow:

- In `index.html`, `finishQuiz()` adds a lesson to both `completed` and `masteredLessons` when the lesson quiz reaches 80%.
- When a later retake is below 80%, the failure branch removes the lesson from `completed` but does **not** remove it from `masteredLessons`.
- The course map derives the completed/mastered state and next-lesson lock from `masteredLessons`, so a previously mastered lesson can remain marked as mastered and keep later content unlocked after a failed retake.
- Cloud progress reconciliation also unions the remote and local `masteredLessons` arrays. Consequently, simply removing an ID locally would not reliably revoke an older remote mastery record; the union could restore it on the next sync.

This is not safe to patch by deleting an ID in one branch. Before changing the behavior, define and approve the learning semantics: whether mastery is permanent once achieved, whether a failed retake can revoke it, and whether retention checks are separate from initial mastery. The UI, progression gates, profile statistics, badges, XP, and cloud reconciliation must all use the same approved definition.

### Required acceptance tests

1. A student who has never mastered a lesson cannot unlock the next lesson by completing training without passing the mastery assessment.
2. A first attempt below 80% does not create mastery, mastery XP, or unlock progression.
3. A passing attempt creates exactly one mastery record and unlocks the next lesson.
4. A later failed retake follows the explicitly approved policy consistently across the lesson tile, course lock, profile count, badges, XP, and cloud state.
5. Syncing local and remote progress in either order cannot resurrect a mastery state that the approved policy says should be revoked.
6. Two devices signed into the same synthetic account converge to the same mastery state after offline edits and sync; two different accounts never share mastery.
7. Lesson completion, training completion, review status, XP, and mastery remain distinct concepts and cannot be substituted for one another in reports.

**Release gate:** do not claim the mentor's mastery/progression requirements are fully satisfied until this inconsistency is resolved under an approved policy and covered by local/cloud regression tests. No production code or student progress data was changed during this audit.

## Login rate limiting and IP metadata

The username-login Edge Function always applies the server-side username attempt bucket. It ignores client-supplied x-forwarded-for and applies the additional IP bucket only when the optional edge cf-connecting-ip header is present and well-formed. Missing IP metadata does not block a valid student sign-in. The IP bucket is defense-in-depth only; do not represent it as a verified identity or as the primary brute-force protection until the hosted Supabase ingress contract is independently verified. CORS origin checks are not authentication and do not prevent non-browser callers from invoking an endpoint.

**Release gate:** verify the mandatory username throttle, the Edge Function's generic error handling, and the provider's built-in Auth rate limits. IP-header provenance is not a hard release dependency because sign-in does not rely on the IP bucket.

## Teacher features — explicitly deferred

Teacher accounts, teacher roles, teacher dashboards, and official teacher reporting are **out of scope for the current student-only release** at the project owner's direction. Do not build them or treat their absence as a blocker for a student-only pilot.

The public `teacher-pilot.html` remains a synthetic-data demonstration only. It must not collect real student names, grades, class lists, or identifiable student information. The `teacher_pilot_results` table and its historical rows are preserved for a future phase, but direct browser access has been revoked and RLS is forced. No student or ordinary authenticated client may write or read those records. Do not restore client CRUD. When teacher functionality is requested in a future phase, design and independently review server-enforced teacher provisioning, class/student assignments, RLS, audit trails, and cross-class isolation before reopening access.

Student learning progress in `learning_progress` is separate and must remain intact and available only to its owning student.

## Student password recovery — implementation added, live verification pending

The student gateway now includes:
- A password-recovery request screen that accepts the email address associated with the student's verified Google identity.
- A generic response that does not reveal whether an account exists.
- A reset-completion screen that requires a valid Supabase recovery session before changing the password.
- Password confirmation and length checks; the existing Auth user ID and its learning-progress ownership are preserved.

The browser calls Supabase Auth `resetPasswordForEmail` and `updateUser`; it does not collect Google passwords or verification codes and does not use a browser-side service-role key.

Before enabling this flow for students, verify in the production Supabase Auth settings:
1. The email provider and email delivery configuration can send recovery messages reliably to the verified email addresses used at signup. Confirm any SMTP/provider requirements and rate limits.
2. The exact deployed site URL is present in the Auth redirect allow-list. The current redirect target is the site's base path.
3. The recovery link opens the deployed site, establishes a recovery session, and reaches the new-password screen on common personal mobile devices.
4. A valid link succeeds; expired, reused, malformed, and wrong-account links fail safely.
5. The existing Auth user ID and its `learning_progress` row remain unchanged after password recovery.
6. Responses remain generic for unknown addresses, and no password, access token, or recovery token is written to logs or local storage.

The UI and mocked browser tests are implemented, but no real production recovery email, SMTP configuration, redirect allow-list, or end-to-end recovery session has been verified through the available project API. **Do not describe account recovery as production-ready until these live checks pass.** If the production email delivery or redirect configuration is unavailable, leave the feature gated and use the verified Google account recovery route until an approved alternative is ready.

## Additional school-release blockers

- **Teacher features (deferred, not a student-release blocker):** teacher accounts and dashboards are out of scope. Keep `teacher-pilot.html` limited to synthetic/demo data; do not enter names, grades, class lists, or identifiable student information. The preserved `teacher_pilot_results` table is closed to browser clients until a future server-authorized teacher workflow is designed.
- **Static lesson files:** the gateway and route guard are browser-side navigation controls. GitHub Pages still serves static HTML files directly, so they are not confidential resources and must not contain student records, answer keys intended to be private, or privileged teacher content. If lesson confidentiality is required, move protected content behind a server-enforced authorization boundary.
- **Account recovery:** a verified-email Supabase Auth recovery flow is now implemented in the gateway and covered by mocked browser tests. Live production email delivery, redirect allow-list, and recovery-session completion remain unverified; keep this gate open until those real-account checks pass.
- **Shared-device data:** local account backups may contain the last 60 chat messages. Sign-out/account switching preserves a local backup; this is disclosed in the privacy policy. The account page now provides a confirmed, account-scoped “delete this account's data from this device” action. Its browser regressions cover active-account-only deletion, preservation of other accounts and unclaimed backups, no cloud deletion or blank-progress upload, sign-out failure, mismatched owner markers, and partial storage-removal failures. The confirmation warns that unsynchronized changes will be lost. If the browser reports a partial cleanup, do not hand off the device until site data is cleared through browser settings. Students are expected to use their own personal devices for the current pilot. Validate common personal iOS/Android browsers and audio behavior; school-owned device testing is not a release gate. Account-scoped isolation remains required if a student signs out or switches accounts on a shared personal device.
- **Login IP rate limiting:** username-level throttling is mandatory. IP throttling is optional defense-in-depth and does not block sign-in when the edge IP header is missing. The function ignores client-supplied x-forwarded-for; do not claim the optional IP bucket is independently verified.

## Current limitation

GitHub browser tests mock the cloud-auth boundary. They validate gateway navigation and local UI behavior, not real Google OAuth, production database policies, or the deployed Edge Function. A successful CI run is not sufficient evidence of school readiness.


## Legacy verified email/password account compatibility

The original Google-only onboarding rule blocked verified email/password accounts created before the student gateway existed. Migration `20261107170000_allow_legacy_verified_email_accounts.sql` adds a narrowly bounded compatibility path:

- A legacy account may claim its own student username only when its Auth user was created before the fixed UTC cutover `2026-11-07 00:00:00+00`, its email is verified, and the request has an authenticated Supabase session.
- The RPC still derives ownership exclusively from `auth.uid()`; it cannot create or edit another user's profile.
- Accounts created on or after the cutover continue to require a verified Google identity.
- The migration does not create, delete, or rewrite Auth users or learning-progress rows. Existing cloud progress remains keyed to the same Auth user ID.

This migration is staged in the PR only. It has not been applied to production. Before production application, review the SQL, reconcile the environment-specific migration ledger, and test both a pre-cutover verified email-only identity and a post-cutover email-only identity in an isolated test project. Verify the legacy account's original progress row remains unchanged.

- The follow-up migration `20261107180000_restrict_legacy_claim_to_existing_learners.sql` tightens that exception further: a pre-cutover email-only account must already own a `learning_progress` row. This prevents unrelated legacy Auth accounts, including deferred staff accounts without learner progress, from claiming student profiles.


## Follow-up audit correction — 8 November 2026

A read-only production Auth metadata check found that the existing account with primary provider `email` also has `google` in its linked provider list and a verified email. The current production `claim_student_username` function accepts a verified Google identity whether Google is the primary provider or a linked provider. Therefore, the primary provider label `email` alone does **not** mean this account is blocked by the production Google-identity condition. No account identifiers or email addresses are recorded here. No production data or settings were changed.

The isolated test project's migration ledger records the legacy-claim behavior under versions `20261107145203` and `20261107145349`, while the current PR contains equivalent staged SQL files named `20261107170000` and `20261107180000`. The resulting test function definition matches the restrictive legacy-learner rule, but the migration version history is not identical to the repository filenames. Do not replay or manually rewrite migration history to make the timestamps match. Before release, reconcile this ledger deliberately and verify the exact staged SQL against a clean isolated database or a disposable local database.

This correction narrows the account-specific compatibility concern; it does not establish a completed real OAuth callback, recovery email/session, or device-level Safari test.


## Leaked-password protection and current plan

The production Supabase organization is currently on the Free plan. Supabase's current password-security documentation states that leaked-password protection is available on Pro and above. Do not attempt to enable it by changing plans or incurring a charge without the project owner's explicit approval. Until a no-cost supported alternative is verified, keep this as a documented security limitation: retain verified-email requirements and server-side login throttling, review the available password-strength controls in the current plan, and do not describe the authentication gateway as fully hardened for a school-wide rollout. A plan upgrade is not part of this PR and is not authorized by this audit.

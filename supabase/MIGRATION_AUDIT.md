# Supabase migration history audit

The connected Supabase project reported these applied migration versions during the November 2, 2026 audit:

- `20261026095547_learning_progress_owner_policies`
- `20261026095700_learning_progress_owner_policies`
- `20261026120515_english_hero_analytics_events`
- `20261026151420_secure_rls_auto_enable_and_optimize_progress_policies`
- `20261102190859_teacher_pilot_results_owner_scoped_sync`
- `20261102191423_harden_teacher_pilot_rls_and_timestamps`
- `20261102202316_teacher_pilot_weekly_session_log`
- `20261102203921_harden_school_data_table_privileges`

Several applied versions were missing from the Git repository. Their migration files have been restored using the live table columns, constraints, policies, triggers, and the migration history as evidence. The restored files are explicitly marked as reconstructed; they are not claimed to be byte-for-byte copies of the original SQL.

The repository also contains `202610260001_learning_progress.sql`, which was not present in the remote migration history at audit time. It is an idempotent bootstrap migration. Do not run an automatic production migration push until local and remote migration history has been reconciled and reviewed.

The untracked repository filename `20261102180000_teacher_pilot_results_owner_scoped_sync.sql` was replaced on this audit branch with the version actually recorded by Supabase: `20261102190859_teacher_pilot_results_owner_scoped_sync.sql`.

No migration in this audit deletes learner progress, teacher pilot results, or historical analytics rows.

# Private champion question bank

The champions challenge uses a server-only question bank. Correct answer indexes must never be committed to this public repository, embedded in browser assets, or returned by the Edge Function.

## Source and shape

- The generator reads the existing 84 lessons from `index.html`; it does not add new vocabulary.
- Each lesson must contain six source words.
- It generates 10 questions per lesson: six English-to-Arabic and four Arabic-to-English.
- Reverse-direction questions exclude Arabic translations shared by multiple source words.
- Each question has four distinct options. The Edge Function randomizes both question selection and option order.

## Generate a private file

From the repository root, run:

```sh
node scripts/build-champion-question-bank.mjs
```

The default output is `../english-hero-private/champion-question-bank.json`, outside this repository. The generator refuses paths inside the repository, creates the directory with owner-only permissions, creates the file with mode `0600`, and will not overwrite an existing file. Do not move it into the repository or upload it to a public artifact.

## Validate and import

The importer accepts only the local Supabase instance or the dedicated `english-hero-auth-test` project by default. It requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the server-side shell environment; never place the service-role key in frontend code, a committed environment file, or a shared chat.

Validate without sending a request:

```sh
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key> \
  node scripts/import-champion-question-bank.mjs ../english-hero-private/champion-question-bank.json --dry-run
```

After the matching migrations have been applied to an isolated local database, the same command without `--dry-run` imports the bank atomically:

```sh
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local-service-role-key> \
  node scripts/import-champion-question-bank.mjs ../english-hero-private/champion-question-bank.json
```

The RPC rejects incomplete or malformed payloads, requires exactly 840 questions (10 per lesson), verifies distinct options and prompts, and inserts all rows in one transaction. It is one-time only and refuses to run if the bank already contains rows.

## Production protection

Production imports are blocked by default. Do not set `ENGLISH_HERO_ALLOW_PRODUCTION_IMPORT=YES` or import into production unless the project owner gives separate, explicit approval. This PR does not apply migrations, deploy the Edge Function, set secrets, or modify any Supabase project.

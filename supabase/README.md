# Database

| Path | Use it when |
|---|---|
| `bootstrap.sql` | Setting up a **new** Supabase project. Run it once in the SQL Editor; it contains the schema and every migration in order. |
| `migrations/` | Updating an **existing** database. Apply the files newer than your last applied one, in filename order. |
| `standalone/` | Reference only. The older one-off scripts from before timestamped migrations, the full schema, and `supabase-security-audit.sql`, a read-only Row-Level Security check that should return zero rows after every deployment. |
| `tests/` | SQL tests for database rules. |
| `functions/` | Edge Functions (the scheduled `developer-backup`). |

## Adding a migration

1. Create `migrations/YYYYMMDDNNNN_short_name.sql`.
2. Append the same SQL to `bootstrap.sql` and `standalone/supabase-schema.sql` between
   `-- BEGIN SYNCED MIGRATION: <file name>` and `-- END SYNCED MIGRATION: <file name>` markers.
3. Run `npm test`. It fails if any copied section no longer matches its source file.

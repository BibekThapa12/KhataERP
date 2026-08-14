# Automated company backup setup

This setup creates a cloud backup every two hours and lets a Windows Scheduled Task synchronize the latest verified files to `B:\` while the browser is closed.

## 1. Apply database changes

Apply `db migration files/supabase-automated-backup-agent-migration.sql`, or use the synchronized complete staging bootstrap for a new environment.

## 2. Configure the Edge Function

Generate one strong random secret. Set the same value as the Edge Function secret and in Supabase Vault:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToHexString($bytes).ToLowerInvariant()
```

```powershell
supabase secrets set BACKUP_AUTOMATION_SECRET=YOUR_RANDOM_SECRET
supabase functions deploy developer-backup --no-verify-jwt
```

The Supabase runtime provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; do not add either value to the frontend or the Windows agent.

Create/update the Vault values used by the cron job:

```sql
select vault.create_secret('https://YOUR_PROJECT.supabase.co', 'project_url');
select vault.create_secret('YOUR_RANDOM_SECRET', 'backup_automation_secret');
```

The migration schedules `khataerp-automated-company-backup` at `0 */2 * * *`. After configuring Vault, manually invoke the Edge Function once or wait for the next even UTC hour. Review `cron.job_run_details`, Edge Function logs, and Developer Dashboard backup status.

## 3. Install the Windows agent

1. Open Developer Dashboard → Local Backup → Create Agent Token.
2. Copy the one-time token.
3. Copy the `windows-backup-agent` folder to the backup computer.
4. Connect the `B:` drive and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows-backup-agent\Install-KhataERPBackupAgent.ps1 -UseClipboard
```

Copy the one-time agent token immediately before running the command. Clipboard mode reads it without displaying it, clears the clipboard, and validates the complete token before replacing the local configuration. If using the secure prompt instead, paste with right-click or Shift+Insert because legacy Windows PowerShell may record `Ctrl+V` as a control character.

The token is encrypted with Windows DPAPI for the installing user. The scheduled task runs at logon and every two hours for ten years, starts missed scheduled runs when Windows can run the task, and refuses overlapping executions. Network availability is checked by the agent itself so Windows does not leave the task permanently queued when its network-profile detection is inaccurate.

## Security and operational notes

- The Storage bucket is private. The agent receives only 15-minute signed URLs after presenting its revocable agent token.
- Agent tokens contain no database or service-role credential and are stored only as SHA-256 hashes in PostgreSQL.
- Revoke a lost computer's token from Developer Dashboard.
- The backup PC must be running, signed in as the installing Windows user, online, and have the selected drive mounted.
- Failed cloud exports preserve the previous valid object and manifest entry. Failed local writes restore the previous local JSON.
- The cloud schedule is evaluated in UTC. `0 */2 * * *` runs every two hours at minute zero.

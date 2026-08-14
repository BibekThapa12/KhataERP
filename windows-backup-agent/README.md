# KhataERP Windows Backup Agent

The agent synchronizes the latest verified cloud backups to a local drive while KhataERP and the browser are closed. It uses Windows Task Scheduler and the current Windows user's DPAPI key; no database or service-role credential is stored locally.

## Install

1. Deploy the `developer-backup` Edge Function and apply the automated-backup migration.
2. In Developer Dashboard, create a Windows Agent token and copy it immediately.
3. Connect the `B:` drive.
4. Open PowerShell as the Windows user who will run the backup and execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install-KhataERPBackupAgent.ps1
```

The installer prompts for the Supabase project URL and token. The task runs at logon and every two hours while that user is signed in. Logs are stored at `%LOCALAPPDATA%\KhataERPBackupAgent\agent.log`.

The computer must be running, connected to the internet, signed in as the installing user, and the selected backup drive must be mounted. A missed run starts when Task Scheduler next has network access.

## Remove

```powershell
powershell -ExecutionPolicy Bypass -File .\Uninstall-KhataERPBackupAgent.ps1
```

param(
  [string]$ProjectUrl,
  [string]$AgentToken,
  [string]$BackupRoot = 'B:\',
  [switch]$UseClipboard
)
$ErrorActionPreference = 'Stop'
if (!$ProjectUrl) { $ProjectUrl = Read-Host 'Supabase project URL (https://PROJECT.supabase.co)' }
if (!$AgentToken -and $UseClipboard) {
  $clipboardText = [string](Get-Clipboard -Raw)
  # Browser selection can contain wrapping whitespace or invisible Unicode marks.
  $normalizedClipboard = $clipboardText -replace '[\s\u200B-\u200D\uFEFF]', ''
  $tokenMatch = [regex]::Match($normalizedClipboard, '(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}')
  if ($tokenMatch.Success) { $AgentToken = $tokenMatch.Value }
  $clipboardText = $null
  $normalizedClipboard = $null
}
if (!$AgentToken) {
  $secureInput = Read-Host 'Paste the one-time Windows Backup Agent token (use right-click or Shift+Insert, not Ctrl+V)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureInput)
  try { $AgentToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$AgentToken = $AgentToken.Trim()
if ($AgentToken -notmatch '^[0-9a-fA-F-]{36}\.[0-9a-fA-F]{64}$') {
  throw 'The agent token is invalid. Copy the complete token from Developer Dashboard and rerun with -UseClipboard, or paste with right-click/Shift+Insert.'
}
# Windows PowerShell 5 treats an empty string as null and rejects it.
if ($UseClipboard) { Set-Clipboard -Value ' ' }
$secureInput = ConvertTo-SecureString $AgentToken -AsPlainText -Force
$AgentToken = $null
if (!(Test-Path -LiteralPath $BackupRoot -PathType Container)) { throw "Backup root is unavailable: $BackupRoot" }
if ($ProjectUrl -notmatch '^https://[a-z0-9.-]+\.supabase\.co/?$') { throw 'Enter a valid HTTPS Supabase project URL.' }

$installDir = Join-Path $env:LOCALAPPDATA 'KhataERPBackupAgent'
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'KhataERPBackupAgent.ps1') -Destination (Join-Path $installDir 'KhataERPBackupAgent.ps1') -Force
$encryptedToken = ConvertFrom-SecureString $secureInput
@{ ProjectUrl = $ProjectUrl.TrimEnd('/'); BackupRoot = [IO.Path]::GetFullPath($BackupRoot); EncryptedToken = $encryptedToken } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installDir 'config.json') -Encoding UTF8

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$(Join-Path $installDir 'KhataERPBackupAgent.ps1')`""
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'KhataERP Automatic Backup' -Action $action -Trigger @($repeat,$logon) -Settings $settings -Description 'Synchronizes encrypted KhataERP company backups to the selected local drive every two hours.' -Force | Out-Null
Start-ScheduledTask -TaskName 'KhataERP Automatic Backup'
Write-Host "KhataERP Backup Agent installed in $installDir" -ForegroundColor Green
Write-Host "Backups will sync to $([IO.Path]::GetFullPath($BackupRoot)) at logon and every two hours while this Windows user is signed in."

$ErrorActionPreference = 'Stop'
Unregister-ScheduledTask -TaskName 'KhataERP Automatic Backup' -Confirm:$false -ErrorAction SilentlyContinue
$installDir = Join-Path $env:LOCALAPPDATA 'KhataERPBackupAgent'
if (Test-Path -LiteralPath $installDir) { Remove-Item -LiteralPath $installDir -Recurse -Force }
Write-Host 'KhataERP Automatic Backup Agent removed.' -ForegroundColor Green

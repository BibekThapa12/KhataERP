param([switch]$KeepConfiguration)
$ErrorActionPreference = 'Stop'
$taskName = 'KhataERP Automatic Backup'
$installDir = Join-Path $env:LOCALAPPDATA 'KhataERPBackupAgent'

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

if (!$KeepConfiguration -and (Test-Path -LiteralPath $installDir -PathType Container)) {
  $resolved = [IO.Path]::GetFullPath($installDir)
  $expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'KhataERPBackupAgent'))
  if ($resolved -ne $expected) { throw "Refusing to remove an unexpected directory: $resolved" }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

Write-Host 'KhataERP Windows Backup Agent removed.' -ForegroundColor Green
if ($KeepConfiguration) { Write-Host "Encrypted configuration retained in $installDir" }

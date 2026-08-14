param([switch]$Once)
$ErrorActionPreference = 'Stop'
$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $agentDir 'config.json'
$logPath = Join-Path $agentDir 'agent.log'
$lockPath = Join-Path $agentDir 'agent.lock'

function Write-AgentLog([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  if ((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 5MB) { Move-Item -LiteralPath $logPath -Destination "$logPath.old" -Force }
}

function Unprotect-Token([string]$Encrypted) {
  $secure = ConvertTo-SecureString $Encrypted
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

if (!(Test-Path -LiteralPath $configPath)) { throw "Agent configuration is missing. Run Install-KhataERPBackupAgent.ps1 first." }
if (Test-Path -LiteralPath $lockPath) {
  $age = (Get-Date) - (Get-Item -LiteralPath $lockPath).LastWriteTime
  if ($age.TotalMinutes -lt 90) { Write-AgentLog 'Skipped because another synchronization is running.'; exit 0 }
  Remove-Item -LiteralPath $lockPath -Force
}
New-Item -ItemType File -Path $lockPath -Force | Out-Null

try {
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $root = [IO.Path]::GetFullPath([string]$config.BackupRoot)
  if (!(Test-Path -LiteralPath $root -PathType Container)) { throw "Backup drive is unavailable: $root" }
  $token = Unprotect-Token ([string]$config.EncryptedToken)
  $projectUrl = ([string]$config.ProjectUrl).TrimEnd('/')
  $headers = @{ Authorization = "Bearer $token" }
  $manifest = Invoke-RestMethod -Method Get -Uri "$projectUrl/functions/v1/developer-backup?mode=manifest" -Headers $headers -TimeoutSec 120
  $completed = 0
  foreach ($entry in @($manifest.entries)) {
    $relative = ([string]$entry.path).Replace('/', [IO.Path]::DirectorySeparatorChar)
    if ([IO.Path]::IsPathRooted($relative) -or $relative.Split([IO.Path]::DirectorySeparatorChar) -contains '..') { throw "Unsafe manifest path rejected: $relative" }
    $target = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (!$target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw "Manifest path escapes the backup root: $relative" }
    $directory = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = "$target.tmp"
    $previous = "$target.previous"
    try {
      Invoke-WebRequest -UseBasicParsing -Uri ([string]$entry.download_url) -OutFile $temporary -TimeoutSec 300
      $actualHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actualHash -ne ([string]$entry.sha256).ToLowerInvariant()) { throw "Checksum verification failed for $relative" }
      $backup = Get-Content -LiteralPath $temporary -Raw | ConvertFrom-Json
      if ($backup.format -ne 'khataerp-portable-company-v1') { throw "Invalid KhataERP backup format for $relative" }
      if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination $previous -Force }
      Move-Item -LiteralPath $temporary -Destination $target -Force
      if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $actualHash) { throw "Final file verification failed for $relative" }
      Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue
      $completed += 1
    } catch {
      Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $target -Force }
      throw
    }
  }
  Write-AgentLog "Synchronization successful. $completed company backup(s) updated from run $($manifest.run_id)."
  exit 0
} catch {
  Write-AgentLog "Synchronization failed: $($_.Exception.Message)"
  exit 1
} finally {
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}

param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
$root = [string]$plan.root
$target = Split-Path -Parent ([string]$plan.executable)
$backup = Join-Path $root 'previous-app'
$backupStage = Join-Path $root 'previous-app.staging'
$backupComplete = $false
$installationStarted = $false
$committed = $false
$healthy = Join-Path $root 'healthy-version'
Set-Content -LiteralPath (Join-Path $root 'helper-started') -Value ([string]$plan.parentPid) -NoNewline
$arguments = @($plan.args | ForEach-Object { [string]$_ })
function Wait-GameExit([int]$processId) {
  for ($i=0; $i -lt 120; $i++) { if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { return }; Start-Sleep -Milliseconds 500 }
  throw 'Game did not exit'
}
try {
  Wait-GameExit ([int]$plan.parentPid)
  if(Test-Path -LiteralPath $backupStage){Remove-Item -LiteralPath $backupStage -Recurse -Force}
  Copy-Item -LiteralPath $target -Destination $backupStage -Recurse -Force
  if(Test-Path -LiteralPath $backup){Remove-Item -LiteralPath $backup -Recurse -Force}
  Move-Item -LiteralPath $backupStage -Destination $backup
  $backupComplete=$true
  Remove-Item -LiteralPath $healthy -ErrorAction SilentlyContinue
  # Preserve installation directory; updated mode preserves shortcut choices.
  $installArgs = @('/S','--updated','--force-run',('/D=' + $target))
  $installationStarted=$true
  $installer = Start-Process -FilePath ([string]$plan.file) -ArgumentList $installArgs -Verb RunAs -PassThru -Wait
  if ($installer.ExitCode -ne 0) { throw 'Installer failed' }
  $ok = $false
  for ($i=0; $i -lt 90; $i++) { if ((Test-Path -LiteralPath $healthy) -and ((Get-Content -LiteralPath $healthy -Raw) -eq [string]$plan.version)) { $ok=$true; break }; Start-Sleep -Seconds 1 }
  if (-not $ok) { throw 'Updated game failed startup health' }
  $committed=$true
  Remove-Item -LiteralPath (Join-Path $root 'ready.json') -Force
  Remove-Item -LiteralPath $backup -Recurse -Force
  Remove-Item -LiteralPath ([string]$plan.file) -Force
} catch {
  if ($committed) { $_ | Out-String | Set-Content -LiteralPath (Join-Path $root 'cleanup-error.txt'); exit 0 }
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $root 'last-error.txt')
  try {
    $recoveryPath=Join-Path $root 'recovery.json'
    $oldFailures=@()
    if(Test-Path -LiteralPath $recoveryPath){$old=Get-Content -LiteralPath $recoveryPath -Raw -Encoding UTF8 | ConvertFrom-Json;$oldFailures=@($old.failedVersions)+@($old.failedVersion)}
    @{ failedVersions=@(($oldFailures+@([string]$plan.version)) | Where-Object { $_ } | Select-Object -Unique) } | ConvertTo-Json | Set-Content -LiteralPath ($recoveryPath+'.tmp')
    Move-Item -LiteralPath ($recoveryPath+'.tmp') -Destination $recoveryPath -Force
  } catch { $_ | Out-String | Add-Content -LiteralPath (Join-Path $root 'last-error.txt') }
  if ($backupComplete -and $installationStarted -and (Test-Path -LiteralPath $backup)) {
    Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq [string]$plan.executable } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    # Recovery of Program Files can require the same standard OS elevation prompt.
    $restore = Join-Path $root 'restore-shell.ps1'
    $quote = { param($s) "'" + $s.Replace("'","''") + "'" }
    $sourceLiteral = & $quote $backup; $targetLiteral = & $quote $target
    "`$ErrorActionPreference='Stop'; Remove-Item -LiteralPath $targetLiteral -Recurse -Force; Copy-Item -LiteralPath $sourceLiteral -Destination $targetLiteral -Recurse -Force" | Set-Content -LiteralPath $restore -Encoding UTF8
    Start-Process powershell.exe -ArgumentList @('-NoProfile','-File',('"'+$restore+'"')) -Verb RunAs -Wait
  }
  Start-Process -FilePath ([string]$plan.executable) -ArgumentList $arguments
}

param([Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
function Normalized-LocalPath([string]$value) {
  if ($value.StartsWith('\\?\')) { $value = $value.Substring(4) }
  return [IO.Path]::GetFullPath($value).TrimEnd('\')
}
$root = [string]$plan.root
$target = Normalized-LocalPath (Split-Path -Parent ([string]$plan.executable))
# Only the all-users registration selects the privileged recovery program.
# User update storage/plan fields never select an elevated restore source.
$registeredTarget = Normalized-LocalPath ([string](Get-ItemPropertyValue -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\Software\e5919a2e-5a63-5e06-80d4-8586e169f51c' -Name InstallLocation))
if (-not [string]::Equals($registeredTarget, $target, [StringComparison]::OrdinalIgnoreCase)) { throw 'Update target differs from registered all-users installation' }
function Protected-RestorePath {
  $key = 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\BricksWar\NativeBootstrap-LegacyRollback'
  if (-not (Test-Path -LiteralPath $key)) { return $null }
  # Attest the machine record before using its executable path for RunAs. A
  # forged record or writable custom install parent must not select elevation.
  $acl = Get-Acl -LiteralPath $key
  $trusted = @('S-1-5-18','S-1-5-32-544')
  if ($trusted -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value) { throw 'Untrusted rollback registry owner' }
  foreach ($ace in $acl.Access) {
    if ($ace.AccessControlType -eq 'Allow' -and (([int]$ace.RegistryRights -band 0x500D0026) -ne 0) -and
        $trusted -notcontains $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) { throw 'Writable rollback registration' }
  }
  $backupRoot = Normalized-LocalPath ([string](Get-ItemPropertyValue -LiteralPath $key -Name BackupRoot))
  if (-not [string]::Equals($backupRoot, $registeredTarget + '.bricks-rollback', [StringComparison]::OrdinalIgnoreCase)) { throw 'Rollback registration differs from original installation' }
  return Join-Path $backupRoot 'restore.exe'
}
$installationStarted = $false
$installationSucceeded = $false
$candidateStart = $null
$originalSession = (Get-Process -Id $PID).SessionId
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
  Remove-Item -LiteralPath $healthy -ErrorAction SilentlyContinue
  # Preserve installation directory; updated mode preserves shortcut choices.
  $installArgs = @('/S','--updated',('/D=' + $target))
  $installationStarted=$true
  $installer = Start-Process -FilePath ([string]$plan.file) -ArgumentList $installArgs -Verb RunAs -PassThru -Wait
  if ($installer.ExitCode -ne 0) { throw 'Installer failed' }
  $installationSucceeded = $true
  # This PowerShell parent retains the original user/session across alternate
  # administrator credentials. The elevated installer never force-runs the game.
  $candidateStart = Get-Date
  $native = Join-Path $target 'native\bricks-bootstrap.exe'
  if (Test-Path -LiteralPath $native) {
    $env:BRICKS_BOOTSTRAP_PROFILE = Split-Path -Parent $root
    $env:BRICKS_BOOTSTRAP_SKIP_DISCOVERY = '1'
    Start-Process -FilePath $native -ArgumentList (@('installed') + $arguments)
  } else { Start-Process -FilePath ([string]$plan.executable) -ArgumentList $arguments }
  $ok = $false
  for ($i=0; $i -lt 90; $i++) { if ((Test-Path -LiteralPath $healthy) -and ((Get-Content -LiteralPath $healthy -Raw) -eq [string]$plan.version)) { $ok=$true; break }; Start-Sleep -Seconds 1 }
  if (-not $ok) { throw 'Updated game failed startup health' }
  $committed=$true
  Remove-Item -LiteralPath (Join-Path $root 'ready.json') -Force
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
  $restore = Protected-RestorePath
  if ($installationSucceeded -and (-not $restore -or -not (Test-Path -LiteralPath $restore))) { throw 'Missing protected recovery helper; candidate will not be relaunched' }
  if ($installationStarted -and $restore -and (Test-Path -LiteralPath $restore)) {
    # Stop only newly started payloads in this original user/session. Stop-Process
    # runs unelevated and cannot use alternate-admin credentials against others.
    $prefix = $registeredTarget.TrimEnd('\') + '\'
    foreach ($candidate in (Get-Process)) {
      try {
        if ($null -ne $candidateStart -and $candidate.SessionId -eq $originalSession -and $candidate.Path -and
            $candidate.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and
            $candidate.StartTime -ge $candidateStart -and -not $candidate.HasExited) {
          Stop-Process -InputObject $candidate -Force -ErrorAction Stop
          $candidate.WaitForExit(10000) | Out-Null
        }
      } catch { $_ | Out-String | Add-Content -LiteralPath (Join-Path $root 'last-error.txt') }
    }
    # The protected native helper derives both trees from the fixed machine
    # identity, validates its baseline and refuses any remaining live app payload.
    # It accepts no source, destination, process ID or script from this plan.
    $recovery = Start-Process -FilePath $restore -ArgumentList @('installer-restore') -Verb RunAs -PassThru -Wait
    if ($recovery.ExitCode -ne 0) { throw 'Protected migration recovery failed; baseline retained' }
  }
  Start-Process -FilePath ([string]$plan.executable) -ArgumentList $arguments
}

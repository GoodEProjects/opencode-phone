#Requires -Version 5.1
<#
  opencode-phone watchdog: relauches web/proxy if either stops listening.
  Meant for Task Scheduler every 5 minutes (/IT = only while logged on).
  Silent unless something is actually restarted (then logs one line).
#>
$ErrorActionPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = Join-Path $Root 'config.cmd'
if (-not (Test-Path -LiteralPath $Config)) { exit 0 }

$cfg = @{}
foreach ($line in (Get-Content -LiteralPath $Config)) {
  if ($line -match '^\s*(?:set\s+)?([^=]+)=(.*)$') { $cfg[$Matches[1].Trim()] = $Matches[2].Trim() }
}
$webPort = [int]($cfg['OPENCODE_PORT']); if (-not $webPort) { $webPort = 4096 }
$phonePort = [int]($cfg['PHONE_PORT']); if (-not $phonePort) { $phonePort = 4098 }

function Test-Port($port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(800)
    $c.Close()
    return $ok
  } catch { return $false }
}

if ((Test-Port $webPort) -and (Test-Port $phonePort)) { exit 0 }

Start-Sleep -Seconds 20  # avoid racing a startup already in progress
if ((Test-Port $webPort) -and (Test-Port $phonePort)) { exit 0 }

$args = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\start-phone.ps1`""
if ($cfg['PHONE_LAN'] -eq '1') { $args += ' -Lan' }
Start-Process powershell.exe -ArgumentList $args -WindowStyle Hidden -WorkingDirectory $Root
"$(Get-Date -Format o) watchdog relaunched stack" | Out-File (Join-Path $Root 'logs\watchdog.log') -Append
exit 0

#Requires -Version 5.1
<#
  opencode-phone launcher (Windows): starts `opencode web` + the phone proxy.
  Usage:
    .\start-phone.ps1            # localhost only (safest)
    .\start-phone.ps1 -Lan       # also reachable on your home Wi-Fi (password still required)
  Reads user/password/ports from config.cmd (created by install.ps1, never committed).
  Both services log to logs\ and restart here if already running (idempotent).
#>
param([switch]$Lan, [switch]$Local)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = Join-Path $Root 'config.cmd'
if (-not (Test-Path -LiteralPath $Config)) {
  Write-Output 'config.cmd not found. Run .\install.ps1 first.'
  exit 1
}

# Load KEY=VALUE pairs from config.cmd into $env (no execution).
foreach ($line in (Get-Content -LiteralPath $Config)) {
  if ($line -match '^\s*(?:set\s+)?([^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process')
  }
}
foreach ($k in @('OPENCODE_SERVER_USERNAME', 'OPENCODE_SERVER_PASSWORD', 'OPENCODE_PORT', 'PHONE_PORT')) {
  if (-not (Get-Item "env:$k" -ErrorAction SilentlyContinue).Value) {
    Write-Output "config.cmd is missing $k. Re-run .\install.ps1."
    exit 1
  }
}

$Logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Path $Logs -Force | Out-Null

# Persist LAN mode for the watchdog (1 = expose proxy on 0.0.0.0).
if ($Lan -or $Local) {
  $want = $Lan ? '1' : '0'
  $lines = @(Get-Content -LiteralPath $Config) | Where-Object { $_ -notmatch '^\s*(?:set\s+)?PHONE_LAN=' }
  $lines += "PHONE_LAN=$want"
  $lines | Set-Content -LiteralPath $Config -Encoding Ascii
}

function Test-Port($port) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', [int]$port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(800)
    $c.Close()
    return $ok
  } catch { return $false }
}

$OpencodeExe = (Get-Command opencode -ErrorAction SilentlyContinue).Source
if (-not $OpencodeExe) {
  Write-Output 'opencode CLI not found on PATH. Install it first: https://opencode.ai/docs'
  exit 1
}
$Python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $Python) { $Python = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $Python) {
  Write-Output 'Python 3 not found. Install it first: https://www.python.org/downloads'
  exit 1
}

if (-not (Test-Port $env:OPENCODE_PORT)) {
  $webLog = Join-Path $Logs 'opencode-web.log'
  Start-Process -WindowStyle Minimized -FilePath $OpencodeExe `
    -ArgumentList "web --port $($env:OPENCODE_PORT) --hostname 127.0.0.1" `
    -RedirectStandardOutput $webLog -RedirectStandardError $webLog `
    -WorkingDirectory $Root
  Write-Output "started opencode web on 127.0.0.1:$($env:OPENCODE_PORT) (log: logs\opencode-web.log)"
} else {
  Write-Output "opencode web already listening on $($env:OPENCODE_PORT), leaving it alone."
}

$ProxyArgs = "--opencode-port $($env:OPENCODE_PORT) --port $($env:PHONE_PORT)"
$ProxyHost = '127.0.0.1'
if ($Lan) { $ProxyArgs += ' --host 0.0.0.0'; $ProxyHost = '0.0.0.0' }
if (-not (Test-Port $env:PHONE_PORT)) {
  $proxyLog = Join-Path $Logs 'phone-proxy.log'
  $proxyPy = Join-Path $Root 'phone-proxy\phone_proxy.py'
  Start-Process -WindowStyle Minimized -FilePath $Python `
    -ArgumentList "`"$proxyPy`" $ProxyArgs" `
    -RedirectStandardOutput $proxyLog -RedirectStandardError $proxyLog `
    -WorkingDirectory $Root
  Write-Output "started phone proxy on ${ProxyHost}:$($env:PHONE_PORT) (log: logs\phone-proxy.log)"
} else {
  Write-Output "phone proxy already listening on $($env:PHONE_PORT), leaving it alone."
}

if ($Lan) {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1).IPAddress
  if (-not $ip) { $ip = '<this-pc-lan-ip>' }
  Write-Output ''
  Write-Output '==== OPEN ON YOUR PHONE (same Wi-Fi) ===='
  Write-Output "  http://${ip}:$($env:PHONE_PORT)"
  Write-Output "  user: $($env:OPENCODE_SERVER_USERNAME)"
  Write-Output '  password: the one you set in install.ps1 (browser offers to save it)'
  Write-Output '========================================='
  Write-Output 'Windows Firewall may ask to allow Python - allow it (private networks only).'
} else {
  Write-Output ''
  Write-Output "Local only. Re-run with -Lan to expose on your home Wi-Fi, or see README for remote (Tailscale/Cloudflare)."
}

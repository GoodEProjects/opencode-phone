#Requires -Version 5.1
<#
  opencode-phone installer (Windows).
  - Checks prereqs (opencode CLI, Python 3).
  - Creates config.cmd with YOUR OWN username + password (never committed to git).
  - Optionally installs Tailscale / cloudflared for away-from-home access.
  - Optionally sets auto-start on logon + a 5-minute watchdog.
  Run:  powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Ask-YesNo($prompt, $defaultYes = $true) {
  $hint = $defaultYes ? 'Y/n' : 'y/N'
  $ans = Read-Host "$prompt [$hint]"
  if ([string]::IsNullOrWhiteSpace($ans)) { return $defaultYes }
  return $ans -match '^(?i)y(es)?$'
}

Write-Output '=== opencode-phone installer ==='
Write-Output ''

$oc = Get-Command opencode -ErrorAction SilentlyContinue
if (-not $oc) {
  Write-Output 'ERROR: opencode CLI not found on PATH.'
  Write-Output 'Install it first: https://opencode.ai/docs  (then re-run this installer)'
  exit 1
}
Write-Output "opencode: $($oc.Source)"
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
if (-not $py) {
  Write-Output 'ERROR: Python 3 not found.'
  Write-Output 'Install it first: https://www.python.org/downloads  (then re-run this installer)'
  exit 1
}
Write-Output "python: $($py.Source)"
Write-Output ''

# ---- your own login ----
$User = Read-Host 'Phone login username [opencode]'
if ([string]::IsNullOrWhiteSpace($User)) { $User = 'opencode' }
do {
  $p1 = Read-Host 'Phone login password (min 8 chars, hidden)' -AsSecureString
  $p2 = Read-Host 'Repeat password' -AsSecureString
  $c1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
  $c2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
  if ($c1 -ne $c2) { Write-Output 'Passwords do not match, try again.'; continue }
  if ($c1.Length -lt 8) { Write-Output 'Too short, use at least 8 characters.'; continue }
  break
} while ($true)

$WebPort = Read-Host 'opencode web port [4096]'
if ([string]::IsNullOrWhiteSpace($WebPort)) { $WebPort = '4096' }
$PhonePort = Read-Host 'phone proxy port [4098]'
if ([string]::IsNullOrWhiteSpace($PhonePort)) { $PhonePort = '4098' }

$Config = Join-Path $Root 'config.cmd'
@(
  'OPENCODE_SERVER_USERNAME=' + $User
  'OPENCODE_SERVER_PASSWORD=' + $c1
  'OPENCODE_PORT=' + $WebPort
  'PHONE_PORT=' + $PhonePort
) | Set-Content -LiteralPath $Config -Encoding Ascii
Remove-Variable c1, c2
# Lock the file to this user only.
icacls $Config /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null
Write-Output "Wrote config.cmd (user-only permissions, gitignored - never share it)."
Write-Output ''

# ---- optional remote access ----
if (Ask-YesNo 'Install Tailscale for away-from-home access (recommended, free)?') {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id Tailscale.Tailscale -e --accept-source-agreements --accept-package-agreements
    Write-Output 'Open Tailscale from Start, log in once on this PC and on your phone. See README.'
  } else {
    Write-Output 'winget not found - install Tailscale manually: https://tailscale.com/download'
  }
  Write-Output ''
} elseif (Ask-YesNo 'Install cloudflared instead (public URL, no phone app)?' $false) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    Write-Output 'See README for the one cloudflared command.'
  } else {
    Write-Output 'winget not found - install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
  }
  Write-Output ''
}

# ---- optional auto-start + watchdog ----
if (Ask-YesNo 'Start phone stack automatically on logon?') {
  $Wsh = New-Object -ComObject WScript.Shell
  $lnk = $Wsh.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\opencode-phone.lnk")
  $lnk.TargetPath = 'powershell.exe'
  $lnk.Arguments = "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\start-phone.ps1`""
  $lnk.WorkingDirectory = $Root
  $lnk.Save()
  Write-Output 'Auto-start shortcut created.'
  Write-Output ''
}
if (Ask-YesNo 'Install 5-minute watchdog (restarts web/proxy if they die)?') {
  schtasks /create /tn 'opencode-phone watch' /tr "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Root\watch-phone-stack.ps1`"" /sc minute /mo 5 /it /f | Out-Null
  Write-Output 'Watchdog task created (runs only while you are logged on).'
  Write-Output ''
}

Write-Output '=== Done. Start it: ==='
Write-Output '  .\start-phone.ps1 -Lan'
Write-Output ''
Write-Output 'Then open the printed http://<pc-ip>:4098 URL on your phone,'
Write-Output 'sign in once with your new login, and let the browser save it.'

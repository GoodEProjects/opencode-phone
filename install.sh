#!/usr/bin/env bash
# opencode-phone installer (macOS / Linux). Windows users: use install.ps1.
# - Checks prereqs (opencode CLI, python3).
# - Creates config.sh with YOUR OWN username + password (chmod 600, never committed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== opencode-phone installer ==="
echo
command -v opencode >/dev/null || { echo "ERROR: opencode CLI not found. Install it first: https://opencode.ai/docs"; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 not found. Install it first."; exit 1; }
echo "opencode: $(command -v opencode)"
echo "python3:  $(command -v python3)"
echo

read -rp "Phone login username [opencode]: " OC_USER
OC_USER="${OC_USER:-opencode}"
while true; do
  read -rsp "Phone login password (min 8 chars): " P1; echo
  read -rsp "Repeat password: " P2; echo
  [ "$P1" = "$P2" ] || { echo "Passwords do not match, try again."; continue; }
  [ "${#P1}" -ge 8 ] || { echo "Too short, use at least 8 characters."; continue; }
  break
done
read -rp "opencode web port [4096]: " WEB_PORT
read -rp "phone proxy port [4098]: " PHONE_PORT
WEB_PORT="${WEB_PORT:-4096}"
PHONE_PORT="${PHONE_PORT:-4098}"

cat > "$ROOT/config.sh" <<EOF
export OPENCODE_SERVER_USERNAME='$OC_USER'
export OPENCODE_SERVER_PASSWORD='$P1'
export OPENCODE_PORT='$WEB_PORT'
export PHONE_PORT='$PHONE_PORT'
EOF
chmod 600 "$ROOT/config.sh"
unset P1 P2
echo "Wrote config.sh (owner-only permissions, gitignored - never share it)."
echo
echo "=== Start it (two terminals, or see README for background options) ==="
echo "  Terminal 1:  source ./config.sh && opencode web --port \$OPENCODE_PORT --hostname 127.0.0.1"
echo "  Terminal 2:  python3 phone-proxy/phone_proxy.py --opencode-port \$OPENCODE_PORT --port \$PHONE_PORT [--host 0.0.0.0 for LAN]"
echo
echo "Then open http://<this-machine-lan-ip>:\$PHONE_PORT on your phone,"
echo "sign in once with your new login, and let the browser save it."

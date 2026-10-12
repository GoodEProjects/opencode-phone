# opencode-phone

Use [opencode](https://opencode.ai) from your phone, 1:1: your real projects,
your real sessions, full chat continuity — plus a file explorer and automatic
project loading that the stock web UI doesn't give you on mobile.

**You run everything on your own machine.** No VPS, no third-party server,
no account with anyone. Your data never leaves hardware you control except
through the remote-access method *you* choose below.

```
phone browser ---> [your remote method] ---> phone-proxy (this repo, :4098)
                                              |-- serves phone enhancements
                                              +--> opencode web (127.0.0.1:4096)
                                                    \-- your projects, sessions, keys
```

## What you get over stock `opencode web`

- **Auto-loaded projects.** A fresh phone shows every PC folder that already
  has sessions — no manual setup, nothing to tap through. Persists forever.
- **Explorer on Add project.** Breadcrumbs, search, quick access, file
  preview, per-folder Open, and a Your-projects list. Desktop-style file
  browsing that works on iOS (which lacks the pickers desktop browsers have).
- **Live refresh.** PC activity appears on the phone within seconds
  (tap-to-refresh pill if you're mid-typing, so no lost drafts).
- **One login.** Sign in once; let the browser save it (iCloud Keychain /
  Google autofill) and you won't type it again.

## Quickstart (Windows)

Prereqs: [opencode CLI](https://opencode.ai/docs) and [Python 3](https://www.python.org/downloads).

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
.\start-phone.ps1 -Lan
```

Open the printed `http://<pc-ip>:4098` URL on your phone (same Wi-Fi),
sign in with the login you just created, save it in the browser. Done.

The installer can also set up auto-start on logon and a 5-minute watchdog
that restarts the web server/proxy if they ever die.

macOS/Linux: `./install.sh`, then follow the printed commands (same idea,
`config.sh` instead of `config.cmd`).

## Away from home (pick one)

Same Wi-Fi needs nothing extra. Outside the house you need a way in:

- **Tailscale (recommended).** Install on PC + phone, log in once on both.
  Open `https://<your-pc>.tail-xxxx.ts.net:4098`. Private tailnet, automatic
  TLS, stable address, nothing public. Installer offers to install it.
- **Cloudflare Tunnel (no phone app).** `cloudflared tunnel --url http://127.0.0.1:4098`
  gives a public `https://…` URL. Anyone on the internet can reach the login
  screen, so keep the password strong. See Cloudflare docs for a stable
  named tunnel with your own domain.
- **Same Wi-Fi only.** Default: everything binds localhost; nothing leaves
  your machine at all. Skip remote entirely.

## Security notes (read this)

- The opencode password (`OPENCODE_SERVER_PASSWORD`) is the **only gate**.
  Make it long, never commit `config.cmd`/`config.sh` (gitignored + locked
  to your user), never share the URL + login together.
- Default bind is localhost. `-Lan` / `--host 0.0.0.0` exposes the proxy to
  your local network only — still password-gated, but prefer Tailscale if
  your network isn't yours.
- One session runs one thing at a time: don't drive the same session from
  PC and phone simultaneously; the second side will spin until the first
  finishes. Different sessions are fully independent.
- No live cross-push between frontends: a message written elsewhere appears
  on your screen via the auto-refresh (seconds), not instantly.

## Troubleshooting

- **Empty projects/sessions on a fresh browser:** expected for ~2 seconds
  while the first-run seed runs (one automatic reload), then everything
  appears. If it stays empty, hard-refresh once (stale shell cache).
- **"Thinking" forever on send:** the session is busy elsewhere (see above),
  or the backend hiccuped — reload and resend.
- **Site unreachable from home Wi-Fi but fine on cellular:** some routers /
  DNS filters hijack unknown hostnames. Use the direct LAN IP (printed by
  the start script), Tailscale, or set private DNS on the phone.
- **Port already in use:** another copy is running — reuse it, or change
  ports in `config.cmd`/`config.sh`.
- **Windows Firewall prompt:** allow Python on private networks when asked.
- **After updating these files:** bump `ASSET_VER` in
  `phone-proxy/phone_proxy.py` so phones fetch the new code, then restart
  the proxy and hard-refresh the phone browser.

## Files

| path | what |
|---|---|
| `install.ps1` / `install.sh` | installers (own login, autostart + watchdog options) |
| `start-phone.ps1` | Windows launcher (web + proxy, `-Lan` for Wi-Fi) |
| `watch-phone-stack.ps1` | 5-minute watchdog (Task Scheduler) |
| `phone-proxy/phone_proxy.py` | localhost injector proxy (stdlib only) |
| `phone-static/` | `phone-boot.js`, `phone-explorer.js`, `phone-explorer.css` |

## Uninstall

Stop the processes, optionally remove the Startup shortcut
(`shell:startup` → delete `opencode-phone.lnk`) and the
`opencode-phone watch` scheduled task. Nothing else was touched.

## License

MIT — see [LICENSE](LICENSE).

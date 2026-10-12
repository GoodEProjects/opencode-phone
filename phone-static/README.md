# phone-static: the mobile web enhancements

Served same-origin by `phone-proxy/phone_proxy.py` and injected into the
opencode web shell. All calls are same-origin and reuse the browser's saved
login. No passwords, keys, or chat content in these files - ever.

- `phone-boot.js` - first-run only: opens every directory that already has
  sessions (plus registered projects) so a fresh phone shows your stuff
  immediately, then reloads once. Never touches existing state.
- `phone-explorer.js` - Explorer-style file browser (breadcrumbs, search,
  quick access, your-projects list, file preview, open-as-project) that opens
  ONLY from the app's own Add project buttons. Plus live refresh: polls the
  session endpoints and reloads on real change (pill instead if typing).
- `phone-explorer.css` - dark Windows-11-style chrome for the explorer.

When you change any of these, bump `ASSET_VER` in `phone_proxy.py` so
browsers fetch fresh code instead of serving cache.

#!/usr/bin/env python3
"""opencode-phone login service. Localhost only (127.0.0.1:14098), never public.

Flow: user opens /login once, enters the SAME login as the app password
prompt. On success the server sets a 1-year HttpOnly Secure cookie.
nginx (auth_request + `satisfy any`) accepts EITHER that cookie OR the
regular password, so API clients/agents keep working unchanged and a
broken cookie never locks anyone out (password still works).

Security notes:
- Passwords are NEVER stored. /opt/opencode-phone/auth_verifier holds
  `user:salt:sha256(salt+password)` only. Tokens are stored hashed.
- Rate limit: >5 failed logins / 5 min per IP -> 429. No passwords logged.
- Binds 127.0.0.1 only. nginx is the sole public path (see vhost).
"""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = '/opt/opencode-phone'
VERIFIER = os.path.join(BASE, 'auth_verifier')
DB = os.path.join(BASE, 'auth_tokens.db')
LOG = os.path.join(BASE, 'auth.log')
COOKIE = 'oplogin'
MAX_AGE = 31536000  # 1 year
FAILS = {}  # ip -> [timestamps]

LOGIN_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Log in</title>
<style>body{background:#080808;color:#eee;font-family:-apple-system,system-ui,sans-serif;
margin:0;padding:32px 20px}h2{font-size:22px}input{display:block;width:100%;max-width:340px;
font-size:18px;padding:14px;margin:10px 0;border-radius:12px;border:1px solid #444;
background:#111;color:#eee;box-sizing:border-box}button{font-size:18px;padding:14px 26px;
border-radius:12px;border:1px solid #4cc2ff;background:#122;color:#fff;min-height:52px}
.err{color:#f88;margin:10px 0}</style></head><body>
<h2>Log in</h2><div class="err">{msg}</div>
<form method="post" action="/login">
<input name="user" placeholder="username" autocomplete="username">
<input name="pw" type="password" placeholder="password" autocomplete="current-password">
<button type="submit">Log in</button></form>
<p style="color:#888;font-size:13px">One login lasts a year on this browser.</p>
</body></html>"""


def log(msg):
    try:
        with open(LOG, 'a') as fh:
            fh.write('%d %s\n' % (int(time.time()), msg))
    except OSError:
        pass


def db():
    fresh = not os.path.exists(DB)
    c = sqlite3.connect(DB)
    if fresh:
        c.execute('CREATE TABLE tokens (th TEXT PRIMARY KEY, user TEXT, exp INTEGER, created INTEGER, ip TEXT)')
    try:
        c.execute('CREATE TABLE IF NOT EXISTS links (th TEXT PRIMARY KEY, user TEXT, exp INTEGER, created INTEGER, ip TEXT)')
    except sqlite3.OperationalError:
        pass
    c.execute('DELETE FROM tokens WHERE exp < ?', (int(time.time()),))
    try:
        c.execute('DELETE FROM links WHERE exp < ?', (int(time.time()),))
    except sqlite3.OperationalError:
        pass
    c.commit()
    return c


def check_password(user, pw):
    try:
        with open(VERIFIER) as fh:
            line = fh.read().strip()
    except OSError:
        return False
    try:
        vu, salt, want = line.split(':')
    except ValueError:
        return False
    if not hmac.compare_digest(vu, user):
        return False
    got = hashlib.sha256((salt + pw).encode()).hexdigest()
    return hmac.compare_digest(got, want)


def throttled(ip):
    now = time.time()
    lst = [t for t in FAILS.get(ip, []) if now - t < 300]
    FAILS[ip] = lst
    return len(lst) >= 5


def note_fail(ip):
    FAILS.setdefault(ip, []).append(time.time())


def token_user(cookies):
    kv = {}
    for part in cookies.split(';'):
        if '=' in part:
            k, v = part.strip().split('=', 1)
            kv[k.strip()] = v.strip()
    tok = kv.get(COOKIE)
    if not tok:
        return None
    th = hashlib.sha256(tok.encode()).hexdigest()
    c = db()
    row = c.execute('SELECT user, exp FROM tokens WHERE th=?', (th,)).fetchone()
    c.close()
    if not row:
        return None
    if row[1] < int(time.time()):
        return None
    return row[0]


def mint(user, ip):
    tok = secrets.token_urlsafe(32)
    th = hashlib.sha256(tok.encode()).hexdigest()
    now = int(time.time())
    c = db()
    c.execute('INSERT OR REPLACE INTO tokens VALUES (?,?,?,?,?)', (th, user, now + MAX_AGE, now, ip))
    c.commit()
    c.close()
    return tok


LINK_TTL = 900  # single-use login links live 15 minutes


def mint_link(user):
    tok = secrets.token_urlsafe(24)
    th = hashlib.sha256(tok.encode()).hexdigest()
    now = int(time.time())
    c = db()
    c.execute('INSERT INTO links VALUES (?,?,?,?,?)', (th, user, now + LINK_TTL, now, '-'))
    c.commit()
    c.close()
    return tok


def redeem_link(tok):
    th = hashlib.sha256(tok.encode()).hexdigest()
    now = int(time.time())
    c = db()
    row = c.execute('SELECT user, exp FROM links WHERE th=?', (th,)).fetchone()
    if not row:
        c.close()
        return None
    c.execute('DELETE FROM links WHERE th=?', (th,))
    c.commit()
    c.close()
    if row[1] < now:
        return None
    return row[0]


class H(BaseHTTPRequestHandler):
    server_version = 'x'
    sys_version = ''

    def _send(self, code, body, ctype='text/html; charset=utf-8', extra=None):
        if isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _ip(self):
        return self.headers.get('X-Real-IP', self.client_address[0])

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/login':
            q = urllib.parse.parse_qs(u.query)
            toks = q.get('token', [])
            if toks:
                if throttled(self._ip()):
                    return self._send(429, LOGIN_PAGE.replace('{msg}', 'Too many tries. Wait 5 minutes.'))
                user = redeem_link((toks[0] or '')[:128])
                if user:
                    tok = mint(user, self._ip())
                    log('link login ok user=%s ip=%s' % (user, self._ip()))
                    cookie = '%s=%s; Path=/; Max-Age=%d; Secure; HttpOnly; SameSite=Lax' % (COOKIE, tok, MAX_AGE)
                    self.send_response(302)
                    self.send_header('Location', '/')
                    self.send_header('Set-Cookie', cookie)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                note_fail(self._ip())
                log('link FAIL ip=%s' % self._ip())
                return self._send(401, LOGIN_PAGE.replace('{msg}', 'That login link is used or expired.'))
            return self._send(200, LOGIN_PAGE.replace('{msg}', ''))
        if u.path == '/check':
            user = token_user(self.headers.get('Cookie', ''))
            if user:
                return self._send(200, '{"ok":true}', 'application/json')
            return self._send(401, '{"ok":false}', 'application/json')
        if u.path == '/logout':
            return self._send(200, LOGIN_PAGE.replace('{msg}', 'Logged out.'),
                              extra={'Set-Cookie': '%s=; Path=/; Max-Age=0' % COOKIE})
        return self._send(404, 'not found', 'text/plain')

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != '/login':
            return self._send(404, 'not found', 'text/plain')
        ip = self._ip()
        if throttled(ip):
            log('throttle ' + ip)
            return self._send(429, LOGIN_PAGE.replace('{msg}', 'Too many tries. Wait 5 minutes.'))
        try:
            ln = int(self.headers.get('Content-Length', 0))
        except ValueError:
            ln = 0
        form = urllib.parse.parse_qs(self.rfile.read(min(ln, 4096)).decode('utf-8', 'replace'))
        user = (form.get('user', [''])[0] or '').strip()[:64]
        pw = (form.get('pw', [''])[0] or '')[:256]
        if user and pw and check_password(user, pw):
            tok = mint(user, ip)
            log('login ok user=%s ip=%s' % (user, ip))
            cookie = '%s=%s; Path=/; Max-Age=%d; Secure; HttpOnly; SameSite=Lax' % (COOKIE, tok, MAX_AGE)
            self.send_response(302)
            self.send_header('Location', '/')
            self.send_header('Set-Cookie', cookie)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        note_fail(ip)
        log('login FAIL user=%s pwlen=%d ip=%s' % (user or '-', len(pw), ip))
        return self._send(401, LOGIN_PAGE.replace('{msg}', 'Wrong login. Try again.'))

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    import sys
    # Mint a single-use login link: phone-auth.py mint-link <user> <base-url>
    # (prints ONE line: the URL. Valid 15 min, dies on first use.)
    if len(sys.argv) == 4 and sys.argv[1] == 'mint-link':
        os.makedirs(BASE, exist_ok=True)
        tok = mint_link(sys.argv[2])
        print('%s/login?token=%s' % (sys.argv[3].rstrip('/'), tok))
        raise SystemExit(0)
    os.makedirs(BASE, exist_ok=True)
    ThreadingHTTPServer(('127.0.0.1', 14098), H).serve_forever()

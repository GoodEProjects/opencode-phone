#!/usr/bin/env python3
"""opencode-phone proxy: sits between the phone and `opencode web` on your PC.

What it does (all on localhost, stdlib only, no dependencies):
  1. Forwards everything to the opencode web server (default 127.0.0.1:4096),
     preserving auth headers, websockets and event streams.
  2. Injects two <script> tags into the app shell so the phone gets:
       - phone-boot.js   : first-run auto-seed of your PC projects/sessions
       - phone-explorer.js: Explorer-style file browser on Add project
     (plus live session refresh; see phone-static/ for details).
  3. Serves those static files itself with no-store (updates apply instantly).

Your data, password and sessions never leave this machine except through
whatever remote-access method YOU choose (LAN, Tailscale, Cloudflare Tunnel).
This proxy adds no auth of its own: opencode's built-in password
(OPENCODE_SERVER_PASSWORD) remains the single gate. Keep it secret.

Usage:
    python phone_proxy.py [--opencode-host 127.0.0.1] [--opencode-port 4096]
                          [--port 4098] [--static-dir ../phone-static]

Then open http://<this-pc-lan-ip>:4098 on your phone (after starting
`opencode web` -- see start scripts / README).
"""
import argparse
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

HERE = os.path.dirname(os.path.abspath(__file__))

# Bump ASSET_VER on every phone-static/ change so browsers fetch fresh code.
ASSET_VER = "v1"
INJECT = ('<script src="/phone-boot.js?v={v}" defer></script>'
          '<script src="/phone-explorer.js?v={v}" defer></script>'
          '<div id="root"').format(v=ASSET_VER)

STATIC_TYPES = {
    '/phone-boot.js': 'text/javascript',
    '/phone-explorer.js': 'text/javascript',
    '/phone-explorer.css': 'text/css',
}

ARGS = None
STATIC_DIR = None


class Handler(BaseHTTPRequestHandler):
    server_version = 'opencode-phone/1'
    sys_version = ''

    def _static(self):
        name = self.path.split('?')[0]
        ctype = STATIC_TYPES.get(name)
        if self.command != 'GET' or ctype is None:
            return False
        local = os.path.join(STATIC_DIR, name.lstrip('/'))
        if not os.path.isfile(local):
            return False
        with open(local, 'rb') as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        return True

    def _proxy(self):
        try:
            ln = int(self.headers.get('Content-Length', 0) or 0)
        except ValueError:
            ln = 0
        body = self.rfile.read(ln) if ln else None
        url = 'http://%s:%d%s' % (ARGS.opencode_host, ARGS.opencode_port, self.path)
        req = Request(url, data=body, method=self.command)
        for k, v in self.headers.items():
            # Force identity upstream so the shell can be patched reliably;
            # sub_filter-style injection cannot work on compressed bytes.
            if k.lower() in ('host', 'content-length', 'connection', 'accept-encoding'):
                continue
            req.add_header(k, v)
        try:
            upstream = urlopen(req, timeout=300)
        except Exception as exc:
            msg = ('opencode-phone: cannot reach opencode at %s:%d (%s). '
                   'Is `opencode web` running?' % (ARGS.opencode_host, ARGS.opencode_port, exc))
            data = msg.encode()
            self.send_response(502)
            self.send_header('Content-Type', 'text/plain')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        ctype = upstream.headers.get('Content-Type', '')
        if 'text/html' in ctype:
            data = upstream.read().replace(b'<div id="root"', INJECT.encode(), 1)
            self.send_response(upstream.status)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(upstream.status)
        if upstream.headers.get('Content-Type'):
            self.send_header('Content-Type', upstream.headers.get('Content-Type'))
        self.end_headers()
        while True:
            chunk = upstream.read(65536)
            if not chunk:
                break
            try:
                self.wfile.write(chunk)
            except (ConnectionAbortedError, BrokenPipeError):
                break

    def _handle(self):
        if not self._static():
            self._proxy()

    do_GET = _handle
    do_POST = _handle
    do_PUT = _handle
    do_PATCH = _handle
    do_DELETE = _handle
    do_OPTIONS = _handle

    def log_message(self, fmt, *args):
        pass


def main():
    global ARGS, STATIC_DIR
    ap = argparse.ArgumentParser(description='opencode-phone local proxy')
    ap.add_argument('--opencode-host', default='127.0.0.1')
    ap.add_argument('--opencode-port', type=int, default=4096)
    ap.add_argument('--host', default='127.0.0.1',
                    help='interface to listen on; use 0.0.0.0 for LAN access (password still required)')
    ap.add_argument('--port', type=int, default=4098)
    ap.add_argument('--static-dir', default=os.path.join(HERE, '..', 'phone-static'))
    ARGS = ap.parse_args()
    STATIC_DIR = os.path.abspath(ARGS.static_dir)
    missing = [n for n in ('phone-boot.js', 'phone-explorer.js', 'phone-explorer.css')
               if not os.path.isfile(os.path.join(STATIC_DIR, n))]
    if missing:
        raise SystemExit('missing static files in %s: %s' % (STATIC_DIR, ', '.join(missing)))
    print('opencode-phone proxy -> opencode %s:%d, serving on %s:%d'
          % (ARGS.opencode_host, ARGS.opencode_port, ARGS.host, ARGS.port), flush=True)
    if ARGS.host == '0.0.0.0':
        print('WARNING: listening on all interfaces. Your opencode password is the only gate - keep it strong.', flush=True)
    ThreadingHTTPServer((ARGS.host, ARGS.port), Handler).serve_forever()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""opencode-phone upload service. Localhost only (127.0.0.1:4097).

Receives phone photos/videos/files and stores them on THIS PC so chat can
reference them BY PATH (no giant base64 inlining):

  POST /upload?filename=v.MOV   body = raw bytes (streamed, constant memory)

200 {"ok":true,"path":"C:\\...\\PhoneUploads\\v.MOV","name":"v.MOV","bytes":N}
400 bad name / 411 length required / 413 over cap (2GB).

Served to the phone through the VPS nginx /upload/ route (same login gate
as everything else). Never public directly. No auth of its own: localhost.
"""
import json
import os
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.expanduser('~'), 'PhoneUploads')
CAP = 2 * 1024 * 1024 * 1024
CHUNK = 65536
SAFE = re.compile(r'[^A-Za-z0-9._\- ]+')


def safe_name(name):
    name = os.path.basename((name or '').strip())[:120]
    name = SAFE.sub('_', name).strip(' .')
    return name or 'upload.bin'


def unique(path):
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    i = 2
    while os.path.exists('%s (%d)%s' % (base, i, ext)):
        i += 1
    return '%s (%d)%s' % (base, i, ext)


class H(BaseHTTPRequestHandler):
    server_version = 'up/1'
    sys_version = ''

    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._send(200, {'ok': True, 'service': 'phone-upload'})

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path.rstrip('/') != '/upload':
            return self._send(404, {'ok': False, 'error': 'not found'})
        try:
            ln = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            ln = 0
        if ln <= 0:
            return self._send(411, {'ok': False, 'error': 'length required'})
        if ln > CAP:
            return self._send(413, {'ok': False, 'error': 'over 2GB cap'})
        q = urllib.parse.parse_qs(u.query)
        name = safe_name(q.get('filename', ['upload.bin'])[0])
        os.makedirs(ROOT, exist_ok=True)
        dest = unique(os.path.join(ROOT, name))
        left = ln
        try:
            with open(dest, 'wb') as fh:
                while left > 0:
                    chunk = self.rfile.read(min(CHUNK, left))
                    if not chunk:
                        break
                    fh.write(chunk)
                    left -= len(chunk)
        except OSError as e:
            try:
                os.remove(dest)
            except OSError:
                pass
            return self._send(500, {'ok': False, 'error': str(e)[:120]})
        if left:
            try:
                os.remove(dest)
            except OSError:
                pass
            return self._send(400, {'ok': False, 'error': 'short body'})
        return self._send(200, {'ok': True, 'path': dest, 'name': os.path.basename(dest),
                                'bytes': ln})

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    os.makedirs(ROOT, exist_ok=True)
    ThreadingHTTPServer(('127.0.0.1', 4097), H).serve_forever()

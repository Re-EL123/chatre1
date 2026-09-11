#!/usr/bin/env node
'use strict';

/**
 * Optional local desktop companion for Chatre.
 * Exposes a tiny HTTP API the agent can call for true OS-level actions
 * (screenshot, open URL in system browser). Disabled by default — run
 * locally only on a machine you control.
 *
 *   node desktop-companion/server.js
 *   # listens on 127.0.0.1:7843
 *
 * Security: binds localhost only; requires X-Chatre-Companion header.
 */

const http = require('http');
const { execFile } = require('child_process');
const TOKEN = process.env.CHATRE_COMPANION_TOKEN || 'local-dev-only';
const PORT = Number(process.env.PORT || 7843);

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  return (
    req.headers['x-chatre-companion'] === TOKEN ||
    req.headers.authorization === 'Bearer ' + TOKEN
  );
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true, service: 'chatre-desktop-companion' });
  }
  if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });

  if (req.method === 'POST' && req.url === '/open') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let data = {};
    try {
      data = JSON.parse(body || '{}');
    } catch {
      return json(res, 400, { error: 'Invalid JSON' });
    }
    const url = String(data.url || '');
    if (!/^https?:\/\//i.test(url)) {
      return json(res, 400, { error: 'url must be http(s)' });
    }
    const cmd =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'cmd'
          : 'xdg-open';
    const args =
      process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    execFile(cmd, args, (err) => {
      if (err) return json(res, 500, { ok: false, error: String(err.message) });
      return json(res, 200, { ok: true, opened: url });
    });
    return;
  }

  return json(res, 404, { error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    'Chatre desktop companion on http://127.0.0.1:' +
      PORT +
      ' (localhost only)',
  );
});

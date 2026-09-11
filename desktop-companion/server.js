#!/usr/bin/env node
'use strict';

/**
 * Chatre desktop companion — local OS actions + optional API bridge.
 *
 * Local API (localhost only):
 *   GET  /health
 *   POST /open            { url }
 *   POST /screenshot
 *   POST /clipboard/get
 *   POST /clipboard/set   { text }
 *   POST /notify          { title, body }
 *
 * Bridge mode (cloud agent can call desktop_* tools):
 *   CHATRE_API_BASE=https://chatre-api.vercel.app \
 *   CHATRE_API_TOKEN=your-token \
 *   node desktop-companion/server.js
 *
 * Security: binds 127.0.0.1 only; local routes need X-Chatre-Companion.
 */

const http = require('http');
const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOKEN = process.env.CHATRE_COMPANION_TOKEN || 'local-dev-only';
const PORT = Number(process.env.PORT || 7843);
const API_BASE = String(process.env.CHATRE_API_BASE || '')
  .trim()
  .replace(/\/$/, '');
const API_TOKEN = String(process.env.CHATRE_API_TOKEN || '').trim();
const COMPANION_ID = process.env.CHATRE_COMPANION_ID || 'main';
const CAPS = [
  'open',
  'screenshot',
  'clipboard_get',
  'clipboard_set',
  'notify',
  'status',
];

function json(res, code, body) {
  const origin = '*';
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Chatre-Companion',
    'Access-Control-Allow-Private-Network': 'true',
  });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  return (
    req.headers['x-chatre-companion'] === TOKEN ||
    req.headers.authorization === 'Bearer ' + TOKEN
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function openUrl(url) {
  return new Promise((resolve) => {
    if (!/^https?:\/\//i.test(url)) {
      return resolve({ ok: false, error: 'url must be http(s)' });
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
      if (err) return resolve({ ok: false, error: String(err.message) });
      resolve({ ok: true, opened: url });
    });
  });
}

function tryExec(cmd, args, opts) {
  try {
    return {
      ok: true,
      out: execFileSync(cmd, args, {
        encoding: 'buffer',
        timeout: 15000,
        maxBuffer: 8 * 1024 * 1024,
        ...(opts || {}),
      }),
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function screenshot() {
  const tmp = path.join(
    os.tmpdir(),
    'chatre-shot-' + Date.now() + '.jpg',
  );
  try {
    if (process.platform === 'darwin') {
      const r = tryExec('screencapture', ['-x', '-t', 'jpg', tmp]);
      if (!r.ok) return { ok: false, error: r.error };
    } else if (process.platform === 'win32') {
      const ps =
        "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('" +
        tmp.replace(/'/g, "''") +
        "',[System.Drawing.Imaging.ImageFormat]::Jpeg)";
      const r = tryExec('powershell', ['-NoProfile', '-Command', ps]);
      if (!r.ok) return { ok: false, error: r.error };
    } else {
      // Linux: try import (ImageMagick), gnome-screenshot, scrot, grim
      let r = tryExec('import', ['-window', 'root', '-quality', '55', tmp]);
      if (!r.ok) r = tryExec('gnome-screenshot', ['-f', tmp]);
      if (!r.ok) r = tryExec('scrot', ['-o', tmp]);
      if (!r.ok) r = tryExec('grim', [tmp]);
      if (!r.ok) {
        return {
          ok: false,
          error:
            'No screenshot tool found (install imagemagick, gnome-screenshot, scrot, or grim)',
        };
      }
    }
    if (!fs.existsSync(tmp)) {
      return { ok: false, error: 'Screenshot file missing' };
    }
    const buf = fs.readFileSync(tmp);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      mime: 'image/jpeg',
      screenshot_base64: buf.toString('base64'),
      bytes: buf.length,
      platform: process.platform,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function clipboardGet() {
  try {
    if (process.platform === 'darwin') {
      const r = tryExec('pbpaste', []);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, text: r.out.toString('utf8').slice(0, 50000) };
    }
    if (process.platform === 'win32') {
      const r = tryExec('powershell', [
        '-NoProfile',
        '-Command',
        'Get-Clipboard',
      ]);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, text: r.out.toString('utf8').slice(0, 50000) };
    }
    let r = tryExec('xclip', ['-selection', 'clipboard', '-o']);
    if (!r.ok) r = tryExec('wl-paste', []);
    if (!r.ok) return { ok: false, error: 'Need xclip or wl-paste' };
    return { ok: true, text: r.out.toString('utf8').slice(0, 50000) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function clipboardSet(text) {
  const value = String(text == null ? '' : text);
  try {
    if (process.platform === 'darwin') {
      execFileSync('pbcopy', [], { input: value, timeout: 5000 });
      return { ok: true, bytes: Buffer.byteLength(value) };
    }
    if (process.platform === 'win32') {
      execFileSync(
        'powershell',
        ['-NoProfile', '-Command', 'Set-Clipboard -Value $input'],
        { input: value, timeout: 5000 },
      );
      return { ok: true, bytes: Buffer.byteLength(value) };
    }
    try {
      execFileSync('xclip', ['-selection', 'clipboard'], {
        input: value,
        timeout: 5000,
      });
      return { ok: true, bytes: Buffer.byteLength(value) };
    } catch {
      execFileSync('wl-copy', [], { input: value, timeout: 5000 });
      return { ok: true, bytes: Buffer.byteLength(value) };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function notify(title, body) {
  const t = String(title || 'Chatre').slice(0, 120);
  const b = String(body || '').slice(0, 500);
  try {
    if (process.platform === 'darwin') {
      execFileSync('osascript', [
        '-e',
        'display notification ' +
          JSON.stringify(b) +
          ' with title ' +
          JSON.stringify(t),
      ]);
      return { ok: true };
    }
    if (process.platform === 'win32') {
      // Best-effort toast via PowerShell balloon
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(3000,${JSON.stringify(t)},${JSON.stringify(b)},[System.Windows.Forms.ToolTipIcon]::Info)`,
        ],
        { timeout: 8000 },
      );
      return { ok: true };
    }
    execFileSync('notify-send', [t, b], { timeout: 5000 });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runAction(action, params) {
  const p = params || {};
  switch (String(action || '')) {
    case 'status':
      return {
        ok: true,
        service: 'chatre-desktop-companion',
        caps: CAPS,
        platform: process.platform,
        bridged: !!(API_BASE && API_TOKEN),
        companionId: COMPANION_ID,
      };
    case 'open':
      return openUrl(String(p.url || ''));
    case 'screenshot':
      return screenshot();
    case 'clipboard_get':
      return clipboardGet();
    case 'clipboard_set':
      return clipboardSet(p.text);
    case 'notify':
      return notify(p.title, p.body || p.text);
    default:
      return { ok: false, error: 'Unknown action: ' + action };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return json(res, 204, {});
  }

  const url = String(req.url || '').split('?')[0];

  if (req.method === 'GET' && url === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'chatre-desktop-companion',
      caps: CAPS,
      platform: process.platform,
      bridged: !!(API_BASE && API_TOKEN),
      companionId: COMPANION_ID,
    });
  }

  if (!authorized(req)) return json(res, 401, { error: 'Unauthorized' });

  try {
    if (req.method === 'POST' && url === '/open') {
      const body = await readBody(req);
      return json(res, 200, await runAction('open', body));
    }
    if (req.method === 'POST' && url === '/screenshot') {
      return json(res, 200, await runAction('screenshot', {}));
    }
    if (req.method === 'POST' && (url === '/clipboard/get' || url === '/clipboard_get')) {
      return json(res, 200, await runAction('clipboard_get', {}));
    }
    if (req.method === 'POST' && (url === '/clipboard/set' || url === '/clipboard_set')) {
      const body = await readBody(req);
      return json(res, 200, await runAction('clipboard_set', body));
    }
    if (req.method === 'POST' && url === '/notify') {
      const body = await readBody(req);
      return json(res, 200, await runAction('notify', body));
    }
    if (req.method === 'POST' && url === '/action') {
      const body = await readBody(req);
      return json(res, 200, await runAction(body.action, body.params || body));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    'Chatre desktop companion on http://127.0.0.1:' +
      PORT +
      ' (localhost only)',
  );
  if (API_BASE && API_TOKEN) {
    console.log('Bridge enabled → ' + API_BASE + ' (id=' + COMPANION_ID + ')');
    startBridge();
  } else {
    console.log(
      'Bridge off — set CHATRE_API_BASE and CHATRE_API_TOKEN for cloud agent desktop tools',
    );
  }
});

async function apiPost(body) {
  const res = await fetch(API_BASE + '/api/companion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + API_TOKEN,
      'x-chatre-key': API_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && data.error) || 'API ' + res.status);
  }
  return data;
}

async function startBridge() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await apiPost({
        op: 'heartbeat',
        companionId: COMPANION_ID,
        caps: CAPS,
      });
      const polled = await apiPost({
        op: 'poll',
        companionId: COMPANION_ID,
        caps: CAPS,
        waitMs: 15000,
        limit: 2,
      });
      const jobs = (polled && polled.jobs) || [];
      for (const job of jobs) {
        const result = await runAction(job.action, job.params || {});
        await apiPost({
          op: 'result',
          jobId: job.id,
          result,
        });
      }
    } catch (err) {
      console.error(
        'Bridge error:',
        err instanceof Error ? err.message : String(err),
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

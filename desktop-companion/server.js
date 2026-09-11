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
  'type',
  'hotkey',
  'click',
  'exec',
  'pty',
];

const ptySessions = new Map();
const DENY_EXEC =
  /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=|shutdown|reboot|curl\s+[^\n]*\|\s*(ba)?sh)\b/i;

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

function desktopType(text) {
  const value = String(text == null ? '' : text);
  if (!value) return { ok: false, error: 'text required' };
  try {
    if (process.platform === 'darwin') {
      // Prefer clipboard paste for unicode safety
      clipboardSet(value);
      execFileSync('osascript', [
        '-e',
        'tell application "System Events" to keystroke "v" using command down',
      ]);
      return { ok: true, method: 'paste', bytes: Buffer.byteLength(value) };
    }
    if (process.platform === 'win32') {
      clipboardSet(value);
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
        ],
        { timeout: 8000 },
      );
      return { ok: true, method: 'paste', bytes: Buffer.byteLength(value) };
    }
    const r = tryExec('xdotool', ['type', '--clearmodifiers', '--', value]);
    if (!r.ok) {
      return {
        ok: false,
        error: 'Need xdotool for desktop_type on Linux: ' + (r.error || ''),
      };
    }
    return { ok: true, method: 'xdotool', bytes: Buffer.byteLength(value) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizeHotkey(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/command/g, 'cmd')
    .replace(/control/g, 'ctrl')
    .replace(/option/g, 'alt');
}

function desktopHotkey(keys) {
  const combo = normalizeHotkey(keys);
  if (!combo) return { ok: false, error: 'keys required' };
  const parts = combo.split('+').filter(Boolean);
  try {
    if (process.platform === 'darwin') {
      const mods = [];
      let key = '';
      parts.forEach((p) => {
        if (p === 'cmd' || p === 'command') mods.push('command down');
        else if (p === 'ctrl') mods.push('control down');
        else if (p === 'alt') mods.push('option down');
        else if (p === 'shift') mods.push('shift down');
        else key = p;
      });
      if (!key) return { ok: false, error: 'No key in combo' };
      const using = mods.length ? ' using {' + mods.join(', ') + '}' : '';
      execFileSync('osascript', [
        '-e',
        'tell application "System Events" to keystroke ' +
          JSON.stringify(key) +
          using,
      ]);
      return { ok: true, keys: combo };
    }
    if (process.platform === 'win32') {
      const map = { ctrl: '^', alt: '%', shift: '+', cmd: '^' };
      let seq = '';
      let key = '';
      parts.forEach((p) => {
        if (map[p]) seq += map[p];
        else key = p.length === 1 ? p : '{' + p.toUpperCase() + '}';
      });
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(' +
            JSON.stringify(seq + key) +
            ')',
        ],
        { timeout: 8000 },
      );
      return { ok: true, keys: combo };
    }
    const mods = [];
    let key = '';
    parts.forEach((p) => {
      if (p === 'ctrl' || p === 'alt' || p === 'shift' || p === 'super' || p === 'cmd') {
        mods.push(p === 'cmd' ? 'super' : p);
      } else key = p;
    });
    if (!key) return { ok: false, error: 'No key in combo' };
    const args =
      mods.length > 0
        ? ['key', mods.concat([key]).join('+')]
        : ['key', key];
    const r = tryExec('xdotool', args);
    if (!r.ok) {
      return { ok: false, error: 'Need xdotool: ' + (r.error || '') };
    }
    return { ok: true, keys: combo };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function desktopClick(x, y, button) {
  const xi = Math.round(Number(x));
  const yi = Math.round(Number(y));
  if (!Number.isFinite(xi) || !Number.isFinite(yi)) {
    return { ok: false, error: 'x and y required' };
  }
  const btn = String(button || 'left').toLowerCase();
  try {
    if (process.platform === 'darwin') {
      // cliclick if present; else AppleScript click at position
      let r = tryExec('cliclick', ['c:' + xi + ',' + yi]);
      if (!r.ok) {
        execFileSync('osascript', [
          '-e',
          'tell application "System Events" to click at {' + xi + ', ' + yi + '}',
        ]);
      }
      return { ok: true, x: xi, y: yi, button: btn };
    }
    if (process.platform === 'win32') {
      const flags =
        btn === 'right'
          ? { down: 0x0008, up: 0x0010 }
          : { down: 0x0002, up: 0x0004 };
      const ps =
        'Add-Type -MemberDefinition @"\n[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);\n[DllImport("user32.dll")] public static extern void mouse_event(int f,int a,int b,int c,int d);\n"@ -Name U -Namespace W; [W.U]::SetCursorPos(' +
        xi +
        ',' +
        yi +
        '); [W.U]::mouse_event(' +
        flags.down +
        ',0,0,0,0); [W.U]::mouse_event(' +
        flags.up +
        ',0,0,0,0)';
      execFileSync('powershell', ['-NoProfile', '-Command', ps], {
        timeout: 8000,
      });
      return { ok: true, x: xi, y: yi, button: btn };
    }
    const map = { left: '1', middle: '2', right: '3' };
    const r = tryExec('xdotool', [
      'mousemove',
      '--sync',
      String(xi),
      String(yi),
      'click',
      map[btn] || '1',
    ]);
    if (!r.ok) {
      return { ok: false, error: 'Need xdotool: ' + (r.error || '') };
    }
    return { ok: true, x: xi, y: yi, button: btn };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function desktopExec(params) {
  const p = params || {};
  if (!p.approved) {
    return {
      ok: false,
      needs_approval: true,
      error: 'desktop_exec requires approved=true (user confirmation)',
    };
  }
  const cmd = String(p.cmd || p.command || '').trim();
  if (!cmd) return { ok: false, error: 'cmd required' };
  if (DENY_EXEC.test(cmd)) {
    return { ok: false, error: 'Command blocked by local deny list' };
  }
  const cwd = p.cwd && fs.existsSync(p.cwd) ? p.cwd : os.homedir();
  const started = Date.now();
  try {
    const out = execFileSync(
      process.platform === 'win32' ? 'cmd' : 'bash',
      process.platform === 'win32' ? ['/c', cmd] : ['-lc', cmd],
      {
        cwd,
        encoding: 'utf8',
        timeout: Math.min(Number(p.timeoutMs) || 60000, 180000),
        maxBuffer: 2 * 1024 * 1024,
        env: process.env,
      },
    );
    return {
      ok: true,
      code: 0,
      output: String(out || '').slice(0, 100000),
      cwd,
      durationMs: Date.now() - started,
      mode: 'local',
    };
  } catch (err) {
    return {
      ok: false,
      code: err && typeof err.status === 'number' ? err.status : 1,
      output: String((err && (err.stdout || err.stderr)) || '').slice(0, 100000),
      error: err && err.message ? err.message : String(err),
      cwd,
      durationMs: Date.now() - started,
      mode: 'local',
    };
  }
}

function desktopPty(params) {
  const p = params || {};
  const action = String(p.action || 'open').toLowerCase();
  if (action === 'open') {
    if (!p.approved) {
      return {
        ok: false,
        needs_approval: true,
        error: 'desktop_pty open requires approved=true',
      };
    }
    const { spawn } = require('child_process');
    const id = 'pty_' + Date.now().toString(36);
    const cwd = p.cwd && fs.existsSync(p.cwd) ? p.cwd : os.homedir();
    const child = spawn(
      process.platform === 'win32' ? 'cmd.exe' : 'bash',
      process.platform === 'win32' ? [] : ['-i'],
      { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const state = { id, child, buffer: '', closed: false };
    child.stdout.on('data', (b) => {
      state.buffer += b.toString('utf8');
      if (state.buffer.length > 200000) state.buffer = state.buffer.slice(-200000);
    });
    child.stderr.on('data', (b) => {
      state.buffer += b.toString('utf8');
    });
    child.on('close', () => {
      state.closed = true;
    });
    ptySessions.set(id, state);
    return { ok: true, session_id: id, cwd, action: 'open' };
  }
  const s = ptySessions.get(String(p.session_id || ''));
  if (!s) return { ok: false, error: 'No PTY session' };
  if (action === 'write') {
    try {
      const data = String(p.data || p.text || '');
      s.child.stdin.write(data.endsWith('\n') ? data : data + '\n');
      return { ok: true, session_id: s.id, action: 'write' };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  }
  if (action === 'read') {
    const out = s.buffer;
    s.buffer = '';
    return {
      ok: true,
      session_id: s.id,
      output: out.slice(0, 40000),
      closed: s.closed,
      action: 'read',
    };
  }
  if (action === 'close') {
    try {
      s.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    ptySessions.delete(s.id);
    return { ok: true, session_id: s.id, closed: true, action: 'close' };
  }
  return { ok: false, error: 'Unknown pty action' };
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
    case 'type':
      return desktopType(p.text);
    case 'hotkey':
      return desktopHotkey(p.keys || p.key);
    case 'click':
      return desktopClick(p.x, p.y, p.button);
    case 'exec':
      return desktopExec(p);
    case 'pty':
      return desktopPty(p);
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
  let failStreak = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await apiPost({
        op: 'heartbeat',
        companionId: COMPANION_ID,
        caps: CAPS,
      });
      failStreak = 0;
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
      failStreak += 1;
      const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(failStreak, 5)));
      console.error(
        'Bridge error (backoff ' +
          delay +
          'ms):',
        err instanceof Error ? err.message : String(err),
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

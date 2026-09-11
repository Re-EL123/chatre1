#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for Chatre Worker + optional API.
 * Usage:
 *   CHATRE_WORKER_URL=https://….workers.dev node scripts/smoke.js
 *   CHATRE_API_URL=https://….vercel.app CHATRE_API_TOKEN=… node scripts/smoke.js
 */

const worker = String(process.env.CHATRE_WORKER_URL || '').replace(/\/$/, '');
const api = String(process.env.CHATRE_API_URL || '').replace(/\/$/, '');
const token = process.env.CHATRE_API_TOKEN || '';
const secret = process.env.CHATRE_WORKER_SECRET || '';

function headers(json) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  if (secret) {
    h.Authorization = 'Bearer ' + secret;
    h['x-chatre-key'] = secret;
  }
  return h;
}

function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (token) {
    h.Authorization = 'Bearer ' + token;
    h['x-chatre-key'] = token;
  }
  return h;
}

async function check(name, fn) {
  try {
    await fn();
    console.log('OK  ', name);
    return true;
  } catch (err) {
    console.error('FAIL', name, '-', err.message || err);
    return false;
  }
}

async function main() {
  let ok = true;
  if (!worker && !api) {
    console.error('Set CHATRE_WORKER_URL and/or CHATRE_API_URL');
    process.exit(1);
  }

  if (worker) {
    ok =
      (await check('worker /api/models', async () => {
        const r = await fetch(worker + '/api/models');
        if (!r.ok) throw new Error('status ' + r.status);
        const j = await r.json();
        if (!j.models) throw new Error('no models');
      })) && ok;

    ok =
      (await check('worker analyst mode', async () => {
        const r = await fetch(worker + '/api/chat', {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({
            mode: 'analyst',
            stream: false,
            messages: [{ role: 'user', content: 'Analyze: say hello briefly' }],
            max_tokens: 256,
          }),
        });
        if (!r.ok) throw new Error('status ' + r.status);
        const j = await r.json();
        if (!j.response) throw new Error('no response');
      })) && ok;

    ok =
      (await check('worker /api/browser search_web', async () => {
        const r = await fetch(worker + '/api/browser', {
          method: 'POST',
          headers: headers(true),
          body: JSON.stringify({
            tool: 'search_web',
            queries: ['cloudflare workers'],
          }),
        });
        // 503 if browser unbound is acceptable for search (should be 200 now)
        if (r.status === 503) {
          const j = await r.json();
          if (!String(j.error || '').includes('Browser')) {
            throw new Error(j.error || '503');
          }
          console.log('     (browser binding missing — search may still work)');
          return;
        }
        if (!r.ok) throw new Error('status ' + r.status);
        const j = await r.json();
        if (!j.results && !j.ok) throw new Error(JSON.stringify(j).slice(0, 200));
      })) && ok;
  }

  if (api) {
    ok =
      (await check('api /api/health', async () => {
        const r = await fetch(api + '/api/health');
        if (!r.ok) throw new Error('status ' + r.status);
      })) && ok;

    if (token) {
      ok =
        (await check('api /api/health?auth=1', async () => {
          const r = await fetch(api + '/api/health?auth=1', {
            headers: apiHeaders(),
          });
          if (!r.ok) throw new Error('status ' + r.status);
        })) && ok;
    }
  }

  process.exit(ok ? 0 : 1);
}

main();

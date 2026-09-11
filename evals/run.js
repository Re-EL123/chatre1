#!/usr/bin/env node
'use strict';

/**
 * Lightweight eval harness — runs analyst mode against evals/cases.jsonl
 * and checks task_type / keyword heuristics (not full tool execution).
 *
 *   CHATRE_WORKER_URL=… node evals/run.js
 */

const fs = require('fs');
const path = require('path');

const worker = String(process.env.CHATRE_WORKER_URL || '').replace(/\/$/, '');
if (!worker) {
  console.error('CHATRE_WORKER_URL required');
  process.exit(1);
}

const secret = process.env.CHATRE_WORKER_SECRET || '';
const casesPath = path.join(__dirname, 'cases.jsonl');
const lines = fs
  .readFileSync(casesPath, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l));

function extractJson(text) {
  const raw = String(text || '');
  try {
    return JSON.parse(raw);
  } catch {
    /* continue */
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

async function analyze(prompt) {
  const headers = { 'Content-Type': 'application/json' };
  if (secret) {
    headers.Authorization = 'Bearer ' + secret;
    headers['x-chatre-key'] = secret;
  }
  const r = await fetch(worker + '/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      mode: 'analyst',
      stream: false,
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Analyze: ' + prompt }],
    }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return extractJson(j.response || '');
}

async function main() {
  let pass = 0;
  for (const c of lines) {
    process.stdout.write(c.id + ' … ');
    try {
      const brief = await analyze(c.prompt);
      if (!brief) throw new Error('no JSON briefing');
      const exp = c.expect || {};
      if (exp.task_type && brief.task_type !== exp.task_type) {
        // allow mixed as soft pass for ambiguous
        if (!(exp.task_type === 'build' && brief.task_type === 'mixed')) {
          throw new Error(
            'task_type got ' + brief.task_type + ' want ' + exp.task_type,
          );
        }
      }
      if (exp.has_plan && !(brief.executor_brief || brief.approach)) {
        throw new Error('missing plan brief');
      }
      console.log('OK', brief.task_type || '');
      pass += 1;
    } catch (err) {
      console.log('FAIL', err.message || err);
    }
  }
  console.log(pass + '/' + lines.length + ' passed');
  process.exit(pass === lines.length ? 0 : 1);
}

main();

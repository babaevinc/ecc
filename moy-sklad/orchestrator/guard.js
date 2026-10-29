#!/usr/bin/env node
'use strict';
/**
 * Rules-of-engagement guard for the «Мой склад» agent team.
 *
 * Usage:
 *   node orchestrator/guard.js --target <url>      check env + target before an active test
 *   node orchestrator/guard.js --env               check only the environment
 *   node orchestrator/guard.js --command "<cmd>"   check one shell command
 *   node orchestrator/guard.js --hook              Claude Code PreToolUse hook (blocks with exit 2)
 *   node orchestrator/guard.js --hook=hermes       Hermes pre_tool_call hook (blocks with {"decision":"block"})
 */
const fs = require('fs');
const path = require('path');

const SCOPE_PATH = process.env.MS_SCOPE_FILE || path.join(__dirname, 'scope.json');

function loadScope(file = SCOPE_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** @returns {{ok: boolean, reason?: string}} */
function checkTarget(url, scope) {
  const origin = originOf(url);
  if (!origin) return { ok: false, reason: `target "${url}" is not a valid http(s) URL` };
  if (!scope.allowedTargets.map(originOf).includes(origin)) {
    return { ok: false, reason: `target ${origin} is outside the approved scope (${scope.allowedTargets.join(', ')})` };
  }
  return { ok: true };
}

/** @returns {{ok: boolean, reasons: string[]}} */
function checkEnv(env, scope) {
  const reasons = [];
  const msEnv = (env.MS_ENV || '').toLowerCase();
  if (!scope.allowedEnvironments.includes(msEnv)) {
    reasons.push(`MS_ENV="${env.MS_ENV || ''}" — set MS_ENV to one of: ${scope.allowedEnvironments.join(', ')}`);
  }
  if ((env.NODE_ENV || '').toLowerCase() === 'production') reasons.push('NODE_ENV=production is not allowed for tests');
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (scope.forbiddenEnvPatterns.some(p => name.toUpperCase().includes(p))) {
      reasons.push(`environment variable ${name} looks like a production credential — unset it before testing`);
    }
  }
  for (const name of ['DATABASE_URL', 'SUPABASE_DB_URL']) {
    if (!env[name]) continue;
    let host = '';
    try { host = new URL(env[name]).hostname; } catch { host = '(unparseable)'; }
    if (!scope.allowedDatabaseHosts.includes(host)) {
      reasons.push(`${name} points at "${host}", which is not an approved test database host`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>`]+/gi;

function flagValue(cmd, names) {
  for (const n of names) {
    const m = cmd.match(new RegExp(`(?:^|\\s)${n}(?:=|\\s+)(\\S+)`));
    if (m) return m[1];
  }
  return null;
}

function durationSeconds(v) {
  const m = String(v).match(/^(\d+)(s|m|h)?$/);
  if (!m) return NaN;
  return Number(m[1]) * ({ s: 1, m: 60, h: 3600 }[m[2] || 's']);
}

/** @returns {{ok: boolean, reason?: string}} */
function checkCommand(cmd, scope) {
  if (typeof cmd !== 'string' || !cmd.trim()) return { ok: true };
  for (const p of scope.destructivePatterns) {
    if (new RegExp(p, 'i').test(cmd)) return { ok: false, reason: `destructive or production operation is forbidden (matched /${p}/)` };
  }
  const words = cmd.toLowerCase().split(/[\s;&|()]+/).map(w => w.split(/[\\/]/).pop().replace(/\.(py|sh|exe)$/, ''));
  const active = scope.activeTools.filter(t => words.includes(t));
  if (!active.length) return { ok: true };
  for (const url of cmd.match(URL_RE) || []) {
    const r = checkTarget(url, scope);
    if (!r.ok) return { ok: false, reason: `${active[0]}: ${r.reason}` };
  }
  if (active.includes('locust')) {
    const L = scope.limits.loadTest;
    const users = Number(flagValue(cmd, ['-u', '--users']));
    const rate = Number(flagValue(cmd, ['-r', '--spawn-rate']));
    const time = flagValue(cmd, ['-t', '--run-time']);
    if (users > L.maxUsers) return { ok: false, reason: `locust: ${users} users exceeds the approved limit of ${L.maxUsers}` };
    if (rate > L.maxSpawnRate) return { ok: false, reason: `locust: spawn rate ${rate} exceeds the approved limit of ${L.maxSpawnRate}` };
    if (time && durationSeconds(time) > durationSeconds(L.maxDuration)) {
      return { ok: false, reason: `locust: run time ${time} exceeds the approved limit of ${L.maxDuration}` };
    }
  }
  return { ok: true };
}

/** Collect every string inside a hook's tool_input (field names differ between harnesses). */
function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(v => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, out));
  return out;
}

function checkHookPayload(payload, scope) {
  for (const s of strings(payload && payload.tool_input)) {
    const r = checkCommand(s, scope);
    if (!r.ok) return r;
  }
  return { ok: true };
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function main(argv) {
  const scope = loadScope();
  const arg = name => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const hookArg = argv.find(a => a === '--hook' || a.startsWith('--hook='));

  if (hookArg) {
    const mode = hookArg.split('=')[1] || 'claude';
    let payload;
    try { payload = JSON.parse(readStdin() || '{}'); } catch {
      process.stderr.write('[MoySkladGuard] unparseable hook payload, allowing\n');
      return 0;
    }
    const r = checkHookPayload(payload, scope);
    if (r.ok) return 0;
    const reason = `BLOCKED by rules of engagement: ${r.reason}. See moy-sklad/orchestrator/scope.json.`;
    if (mode === 'hermes') {
      process.stdout.write(JSON.stringify({ decision: 'block', reason }));
      return 0;
    }
    process.stderr.write(reason + '\n');
    return 2;
  }

  if (argv.includes('--command')) {
    const r = checkCommand(arg('--command'), scope);
    console.log(r.ok ? 'OK: command allowed' : `DENY: ${r.reason}`);
    return r.ok ? 0 : 1;
  }

  const env = checkEnv(process.env, scope);
  const target = argv.includes('--target') ? checkTarget(arg('--target') || '', scope) : { ok: true };
  const problems = [...env.reasons, ...(target.ok ? [] : [target.reason])];
  if (problems.length) {
    problems.forEach(p => console.error(`DENY: ${p}`));
    return 1;
  }
  console.log(`OK: environment "${process.env.MS_ENV}"${argv.includes('--target') ? `, target ${originOf(arg('--target'))}` : ''} is within scope`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { loadScope, checkTarget, checkEnv, checkCommand, checkHookPayload, originOf };

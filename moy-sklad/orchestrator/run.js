#!/usr/bin/env node
'use strict';
/**
 * Orchestrator for the «Мой склад» agent team.
 * Cycle: develop → test → detect → fix → reverify (see team.json "cycle").
 *
 *   node orchestrator/run.js [--stages unit,e2e] [--dispatch handoff|claude|none]
 *                            [--target http://127.0.0.1:8787] [--max-iterations 3]
 *                            [--strict] [--skip-active]
 *
 * Exit codes: 0 all green · 1 failures remain or guard refused · 3 findings handed off, waiting for fixes
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const guard = require('./guard');

const ROOT = path.resolve(__dirname, '..');
const REPORTS = path.join(ROOT, 'reports');
const LOG_TAIL = 4000;
const STAGE_TIMEOUT_MS = 15 * 60 * 1000;

function parseArgs(argv) {
  const o = { stages: null, dispatch: 'handoff', target: null, maxIterations: null, strict: false, skipActive: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--stages') o.stages = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--dispatch') o.dispatch = argv[++i];
    else if (a === '--target') o.target = argv[++i];
    else if (a === '--max-iterations') o.maxIterations = Number(argv[++i]);
    else if (a === '--strict') o.strict = true;
    else if (a === '--skip-active') o.skipActive = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!['handoff', 'claude', 'none'].includes(o.dispatch)) throw new Error('--dispatch must be handoff, claude or none');
  return o;
}

function hasBin(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' });
  return r.status === 0;
}

/** @returns {string|null} missing requirement, or null when all are present */
function missingRequirement(stage, root = ROOT) {
  for (const req of stage.requires || []) {
    if (req.startsWith('module:')) {
      try { require.resolve(req.slice(7), { paths: [root, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)] }); } catch { return req; }
    } else if (req.startsWith('file:')) {
      if (!fs.existsSync(path.join(root, req.slice(5)))) return req;
    } else if (req.startsWith('env:')) {
      if (!process.env[req.slice(4)]) return `${req} (set ${req.slice(4)})`;
    } else if (!hasBin(req)) return req;
    else if (req === 'docker' && spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 20000 }).status !== 0) return 'docker daemon (start Docker)';
  }
  return null;
}

function dockerTargetFor(target) {
  if (process.platform === 'linux') return { network: '--network host', target };
  const u = new URL(target);
  u.hostname = 'host.docker.internal';
  return { network: '', target: u.origin };
}

function render(cmd, vars) {
  return cmd.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function tail(s) {
  return s.length > LOG_TAIL ? '…' + s.slice(-LOG_TAIL) : s;
}

async function healthy(target) {
  try { return (await fetch(`${target}/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

async function ensureTestServer(target) {
  if (await healthy(target)) return null;
  const u = new URL(target);
  const child = spawn(process.execPath, [path.join(ROOT, 'backend/test-api/server.js')], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: u.port || '80', HOST: u.hostname === 'localhost' ? '127.0.0.1' : u.hostname },
  });
  for (let i = 0; i < 40; i++) {
    if (await healthy(target)) return child;
    await new Promise(r => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`test API did not start at ${target}`);
}

function runStage(stage, ctx) {
  const missing = missingRequirement(stage);
  if (missing) return { status: 'skipped', reason: `not available: ${missing}` };
  if (stage.kind === 'active' && ctx.skipActive) return { status: 'skipped', reason: 'active stages disabled (--skip-active)' };
  const d = dockerTargetFor(ctx.target);
  const cmd = render(stage.cmd, { target: ctx.target, dockerTarget: d.target, dockerNetwork: d.network, reportsDir: REPORTS });
  const verdict = guard.checkCommand(cmd, ctx.scope);
  if (!verdict.ok) return { status: 'fail', reason: `guard refused: ${verdict.reason}`, cmd };
  const started = Date.now();
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', timeout: STAGE_TIMEOUT_MS, env: { ...process.env, MS_TARGET: ctx.target } });
  const log = tail(`${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`);
  const code = r.status === null ? -1 : r.status;
  const status = code === 0 ? 'pass' : (stage.warnExitCodes || []).includes(code) ? 'warn' : 'fail';
  return { status, exitCode: code, seconds: Math.round((Date.now() - started) / 1000), cmd, log };
}

function toFindings(results, iteration) {
  return results
    .filter(r => r.status === 'fail' || r.status === 'warn')
    .map(r => ({
      id: `${r.stage}-${iteration}`,
      stage: r.stage,
      owner: r.owner,
      fixer: r.fixer,
      severity: r.status === 'fail' ? 'high' : 'medium',
      summary: r.reason || `stage "${r.stage}" exited with code ${r.exitCode}`,
      command: r.cmd,
      log: r.log || '',
      status: 'open',
    }));
}

function findingBody(f) {
  return [
    `# Находка ${f.id}`, '',
    `- Стадия: ${f.stage} (проверяющий: ${f.owner})`,
    `- Исполнитель: ${f.fixer}`,
    `- Серьёзность: ${f.severity}`,
    `- Команда для повторной проверки: node orchestrator/run.js --stages ${f.stage}`, '',
    '## Что произошло', '', f.summary, '',
    '## Хвост лога', '', '```text', f.log.trim() || '(пусто)', '```', '',
    '## Что сделать', '',
    'Воспроизведи, найди корневую причину, исправь в пределах своей роли и ограничений,',
    'добавь регрессионный тест, затем повтори проверку командой выше. Не ослабляй тесты и не меняй scope.json.',
  ].join('\n');
}

function eccCommand() {
  const custom = process.env.MS_ECC_CMD;
  if (custom) return custom.split(' ').filter(Boolean);
  return hasBin('ecc') ? ['ecc'] : null;
}

function dispatchHandoff(findings, team) {
  const notes = [];
  const ecc = eccCommand();
  for (const f of findings) {
    const dir = path.join(ROOT, team.dispatch.handoff.inbox, f.fixer);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${f.id}.md`);
    fs.writeFileSync(file, findingBody(f));
    notes.push(`inbox: ${path.relative(ROOT, file)}`);
    if (!ecc) continue;
    const args = team.dispatch.handoff.eccMemory.slice(1).map(a => render(a, { agent: f.fixer, title: `moy-sklad ${f.id}: ${f.stage}` }));
    const r = spawnSync(ecc[0], [...ecc.slice(1), ...args], { cwd: ROOT, input: findingBody(f), encoding: 'utf8' });
    notes.push(r.status === 0 ? `ecc memory: handed ${f.id} to ${f.fixer}` : `ecc memory handoff failed for ${f.id}: ${(r.stderr || '').trim().split('\n')[0]}`);
  }
  if (!ecc) notes.push('ecc CLI not found (set MS_ECC_CMD or install ecc-universal) — handoffs written to the inbox only');
  return notes;
}

function dispatchClaude(findings, team) {
  const c = team.dispatch.claude;
  if (!hasBin(c.command)) return [`${c.command} CLI not found — cannot dispatch fixes`];
  return findings.map(f => {
    const args = c.args.map(a => render(a, { agent: f.fixer }));
    const r = spawnSync(c.command, [...args, findingBody(f)], { cwd: ROOT, encoding: 'utf8', timeout: STAGE_TIMEOUT_MS, env: { ...process.env, MS_ENV: process.env.MS_ENV } });
    return `claude --agent ${f.fixer} for ${f.id}: exit ${r.status}`;
  });
}

function writeReports(iteration, results, findings, notes) {
  fs.mkdirSync(REPORTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(REPORTS, `run-${stamp}-i${iteration}.json`), JSON.stringify({ iteration, results, findings, notes }, null, 2));
  fs.writeFileSync(path.join(REPORTS, 'findings.json'), JSON.stringify(findings, null, 2));
  const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skipped: 'SKIP' };
  const md = [`# Прогон «Мой склад», итерация ${iteration}`, '', '| Стадия | Проверяющий | Результат | Причина / время |', '|---|---|---|---|',
    ...results.map(r => `| ${r.stage} | ${r.owner} | ${icon[r.status]} | ${r.reason || (r.seconds !== undefined ? r.seconds + ' с' : '')} |`),
    '', findings.length ? `Находок: ${findings.length}. Исполнители: ${[...new Set(findings.map(f => f.fixer))].join(', ')}.` : 'Находок нет.',
    ...(notes.length ? ['', '## Передача заданий', '', ...notes.map(n => `- ${n}`)] : [])];
  fs.writeFileSync(path.join(REPORTS, 'summary.md'), md.join('\n') + '\n');
}

async function main(argv) {
  const opts = parseArgs(argv);
  const team = JSON.parse(fs.readFileSync(path.join(__dirname, 'team.json'), 'utf8'));
  const scope = guard.loadScope();
  const env = guard.checkEnv(process.env, scope);
  if (!env.ok) { env.reasons.forEach(r => console.error(`DENY: ${r}`)); return 1; }
  const target = opts.target || scope.allowedTargets[0];
  const t = guard.checkTarget(target, scope);
  if (!t.ok) { console.error(`DENY: ${t.reason}`); return 1; }

  const stages = team.stages.filter(s => !opts.stages || opts.stages.includes(s.id));
  if (opts.stages) {
    const unknown = opts.stages.filter(id => !team.stages.some(s => s.id === id));
    if (unknown.length) { console.error(`unknown stage(s): ${unknown.join(', ')}`); return 1; }
  }
  fs.mkdirSync(REPORTS, { recursive: true });
  try { fs.chmodSync(REPORTS, 0o777); } catch { /* ZAP container user needs write access on Linux */ }

  const maxIterations = opts.maxIterations || scope.limits.maxIterations;
  const needsServer = stages.some(s => s.kind === 'active' && !opts.skipActive && !missingRequirement(s));
  const server = needsServer ? await ensureTestServer(target) : null;
  try {
    for (let i = 1; i <= maxIterations; i++) {
      const results = stages.map(s => {
        process.stdout.write(`> [${i}/${maxIterations}] ${s.id} (${s.owner}) ... `);
        const r = { stage: s.id, owner: s.owner, fixer: s.fixer, kind: s.kind, ...runStage(s, { target, scope, skipActive: opts.skipActive }) };
        console.log(r.status + (r.reason ? ` — ${r.reason}` : ''));
        return r;
      });
      const findings = toFindings(results, i);
      const skipped = results.filter(r => r.status === 'skipped');
      const failing = findings.filter(f => f.severity === 'high').length;
      let notes = [];
      if (failing && opts.dispatch === 'handoff') notes = dispatchHandoff(findings, team);
      if (failing && opts.dispatch === 'claude' && i < maxIterations) notes = dispatchClaude(findings, team);
      writeReports(i, results, findings, notes);
      notes.forEach(n => console.log(`  → ${n}`));
      if (!failing && opts.strict && skipped.length) {
        console.log(`FAIL --strict: ${skipped.length} stage(s) could not run (${skipped.map(r => `${r.stage}: ${r.reason}`).join('; ')}). Install the tools and rerun.`);
        return 1;
      }
      if (!failing) {
        console.log(`OK: all selected stages green${skipped.length ? ` (${skipped.length} skipped: ${skipped.map(r => r.stage).join(', ')})` : ''}. Report: reports/summary.md`);
        return 0;
      }
      if (opts.dispatch === 'handoff') { console.log('WAIT: findings handed off; rerun after fixes to reverify. Report: reports/summary.md'); return 3; }
      if (opts.dispatch === 'none') { console.log('FAIL: failures remain. Report: reports/summary.md'); return 1; }
    }
    console.log(`FAIL: still failing after ${maxIterations} iterations — a human needs to look. Report: reports/summary.md`);
    return 1;
  } finally {
    if (server) server.kill();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(e.message); process.exit(1); });
}

module.exports = { parseArgs, missingRequirement, dockerTargetFor, render, toFindings, findingBody, runStage };

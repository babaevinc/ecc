'use strict';
// deploy/migrate.sh against a throwaway database on the approved test server (MS_DB_URL):
// applies every migration once, records it, skips it on the next run, and rolls a broken file back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const guard = require('../../orchestrator/guard');

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'deploy/migrate.sh');
const SUPA = path.join(ROOT, 'backend/supabase');
const server = process.env.MS_DB_URL;

function psql(url, sql) {
  const r = spawnSync('psql', [url, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

function migrate(url, release) {
  const r = spawnSync('bash', [SCRIPT, release], { encoding: 'utf8', env: { ...process.env, MS_PSQL: `psql ${url}`, MS_SKIP_SERVER: '1' } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('migrate.sh applies migrations once, then skips them; a broken file changes nothing', { skip: !server && 'MS_DB_URL is not set' }, t => {
  const env = guard.checkEnv(process.env, guard.loadScope());
  assert.ok(env.ok, env.reasons?.join('; '));
  const name = `ms_deploy_${process.pid}_${Date.now()}`;
  const url = (() => { const u = new URL(server); u.pathname = `/${name}`; return u.toString(); })();
  psql(server, `create database ${name};`);
  const release = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-release-'));
  t.after(() => {
    spawnSync('psql', [server, '-X', '-q', '-c', `drop database if exists ${name} with (force);`]);
    fs.rmSync(release, { recursive: true, force: true });
  });
  // Supabase provides the auth schema; the local shim stands in for it, as in the other DB tests.
  psql(url, fs.readFileSync(path.join(SUPA, 'tests/local-auth-shim.sql'), 'utf8'));
  fs.cpSync(path.join(SUPA, 'migrations'), path.join(release, 'backend/supabase/migrations'), { recursive: true });
  const files = fs.readdirSync(path.join(SUPA, 'migrations')).filter(f => f.endsWith('.sql')).sort();

  const first = migrate(url, release);
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, new RegExp(`migrations applied: ${files.length}`));
  assert.equal(psql(url, 'select string_agg(version, \',\' order by version) from supabase_migrations.schema_migrations;'),
    files.map(f => f.split('_')[0]).join(','));
  assert.equal(psql(url, "select to_regclass('public.scanners') is not null;"), 't');

  const second = migrate(url, release);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /migrations applied: 0/);

  fs.writeFileSync(path.join(release, 'backend/supabase/migrations/29990101000000_broken.sql'),
    'create table public.half_done (id int);\nselect no_such_function();\n');
  const broken = migrate(url, release);
  assert.notEqual(broken.code, 0);
  assert.match(broken.err, /29990101000000_broken\.sql failed; nothing from it was applied/);
  assert.equal(psql(url, "select to_regclass('public.half_done') is null;"), 't');
  assert.equal(psql(url, "select count(*) from supabase_migrations.schema_migrations where version = '29990101000000';"), '0');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../../orchestrator/guard');

const scope = guard.loadScope();

test('only approved origins are valid targets', () => {
  assert.equal(guard.checkTarget('http://127.0.0.1:8787/api/batches', scope).ok, true);
  assert.equal(guard.checkTarget('http://localhost:8787', scope).ok, true);
  assert.equal(guard.checkTarget('https://moysklad.example.com', scope).ok, false);
  assert.equal(guard.checkTarget('http://127.0.0.1:5432', scope).ok, false);
  assert.equal(guard.checkTarget('file:///etc/passwd', scope).ok, false);
});

test('environment must be test-like and free of production credentials', () => {
  assert.equal(guard.checkEnv({ MS_ENV: 'test' }, scope).ok, true);
  assert.equal(guard.checkEnv({}, scope).ok, false);
  assert.equal(guard.checkEnv({ MS_ENV: 'production' }, scope).ok, false);
  assert.equal(guard.checkEnv({ MS_ENV: 'test', NODE_ENV: 'production' }, scope).ok, false);
  assert.equal(guard.checkEnv({ MS_ENV: 'test', SUPABASE_PROD_KEY: 'x' }, scope).ok, false);
  assert.equal(guard.checkEnv({ MS_ENV: 'test', DATABASE_URL: 'postgres://u:p@db.real-host.ru:5432/x' }, scope).ok, false);
  assert.equal(guard.checkEnv({ MS_ENV: 'ci', DATABASE_URL: 'postgres://u:p@127.0.0.1:54322/postgres' }, scope).ok, true);
  assert.equal(guard.checkEnv({ MS_ENV: 'test', MS_DB_URL: 'postgres://u:p@prod-db.example.com:5432/x' }, scope).ok, false);
});

test('destructive and production commands are refused', () => {
  for (const cmd of [
    'rm -rf / --no-preserve-root',
    'psql -c "DROP DATABASE sklad"',
    'git push origin main --force',
    'npx supabase db push',
    'npx supabase db reset --linked',
    'eas submit --platform ios',
  ]) assert.equal(guard.checkCommand(cmd, scope).ok, false, cmd);
});

test('active tools may only hit approved targets and limits', () => {
  assert.equal(guard.checkCommand('curl https://api.real-shop.ru/users', scope).ok, false);
  assert.equal(guard.checkCommand('zap-baseline.py -t https://google.com', scope).ok, false);
  assert.equal(guard.checkCommand('docker run ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://127.0.0.1:8787', scope).ok, true);
  assert.equal(guard.checkCommand('locust --headless -u 20 -r 5 -t 30s --host http://127.0.0.1:8787', scope).ok, true);
  assert.equal(guard.checkCommand('locust --headless -u 500 -r 5 -t 30s --host http://127.0.0.1:8787', scope).ok, false);
  assert.equal(guard.checkCommand('locust --headless -u 20 -r 5 -t 2h --host http://127.0.0.1:8787', scope).ok, false);
});

test('ordinary development commands pass', () => {
  for (const cmd of ['npm test', 'node --test tests/unit/', 'npx playwright test --project=api', 'git status', 'npm install https-proxy-agent']) {
    assert.equal(guard.checkCommand(cmd, scope).ok, true, cmd);
  }
});

test('hook payloads from Claude Code and Hermes are inspected', () => {
  assert.equal(guard.checkHookPayload({ tool_name: 'Bash', tool_input: { command: 'curl https://evil.example' } }, scope).ok, false);
  assert.equal(guard.checkHookPayload({ hook_event_name: 'pre_tool_call', tool_name: 'terminal', tool_input: { cmd: 'git push -f origin main --force' } }, scope).ok, false);
  assert.equal(guard.checkHookPayload({ tool_name: 'Edit', tool_input: { file_path: 'a.js', new_string: 'x' } }, scope).ok, true);
  assert.equal(guard.checkHookPayload({}, scope).ok, true);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const run = require('../../orchestrator/run');

test('arguments are parsed and validated', () => {
  const o = run.parseArgs(['--stages', 'unit, e2e', '--dispatch', 'none', '--strict', '--max-iterations', '2']);
  assert.deepEqual(o.stages, ['unit', 'e2e']);
  assert.equal(o.dispatch, 'none');
  assert.equal(o.strict, true);
  assert.equal(o.maxIterations, 2);
  assert.throws(() => run.parseArgs(['--dispatch', 'deploy']));
  assert.throws(() => run.parseArgs(['--prod']));
});

test('placeholders are filled and unknown ones are kept', () => {
  assert.equal(run.render('locust --host {target} {nope}', { target: 'http://127.0.0.1:8787' }), 'locust --host http://127.0.0.1:8787 {nope}');
});

test('docker target uses host networking on Linux and host.docker.internal elsewhere', () => {
  const d = run.dockerTargetFor('http://127.0.0.1:8787');
  if (process.platform === 'linux') assert.deepEqual(d, { network: '--network host', target: 'http://127.0.0.1:8787' });
  else assert.deepEqual(d, { network: '', target: 'http://host.docker.internal:8787' });
});

test('missing tools make a stage skipped, never passed', () => {
  assert.equal(run.missingRequirement({ requires: ['definitely-not-a-real-tool-ms'] }), 'definitely-not-a-real-tool-ms');
  assert.equal(run.missingRequirement({ requires: ['file:does-not-exist.lock'] }), 'file:does-not-exist.lock');
  assert.equal(run.missingRequirement({ requires: ['node'] }), null);
  const r = run.runStage({ id: 'x', requires: ['definitely-not-a-real-tool-ms'], cmd: 'true' }, { target: 'http://127.0.0.1:8787' });
  assert.equal(r.status, 'skipped');
});

test('the guard refuses a stage whose command leaves the scope', () => {
  const scope = require('../../orchestrator/guard').loadScope();
  const r = run.runStage({ id: 'evil', requires: ['node'], cmd: 'curl https://example.org' }, { target: 'http://127.0.0.1:8787', scope });
  assert.equal(r.status, 'fail');
  assert.match(r.reason, /guard refused/);
});

test('failed and warned stages become findings for the fixer', () => {
  const findings = run.toFindings([
    { stage: 'unit', owner: 'qa-automation', fixer: 'dev-debug', status: 'pass' },
    { stage: 'zap', owner: 'sec-pentest', fixer: 'dev-backend', status: 'warn', exitCode: 2, log: 'WARN-NEW: 10038' },
    { stage: 'e2e', owner: 'qa-automation', fixer: 'dev-debug', status: 'fail', exitCode: 1, log: '1 failed' },
  ], 2);
  assert.deepEqual(findings.map(f => [f.id, f.fixer, f.severity]), [['zap-2', 'dev-backend', 'medium'], ['e2e-2', 'dev-debug', 'high']]);
  assert.match(run.findingBody(findings[1]), /node orchestrator\/run\.js --stages e2e/);
});

'use strict';
// Validates the 12 agent configurations (+ orchestrator) against ECC's agent format and team.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const AGENTS_DIR = path.join(ROOT, '.claude/agents');
const team = JSON.parse(fs.readFileSync(path.join(ROOT, 'orchestrator/team.json'), 'utf8'));
const VALID_MODELS = ['haiku', 'sonnet', 'opus'];
const VALID_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'];
const REQUIRED_SECTIONS = ['## Обязанности', '## Инструменты', '## Ограничения', '## Вход', '## Выход'];
const DEV = ['dev-architect', 'dev-frontend', 'dev-backend', 'dev-database', 'dev-devops', 'dev-debug'];
const VERIFY = ['sec-pentest', 'sec-red-team', 'sec-auditor', 'sec-access-control', 'qa-load', 'qa-automation'];

function parse(file) {
  const text = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, `${file}: frontmatter missing`);
  const fm = Object.fromEntries(m[1].split('\n').map(l => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
  return { fm, body: m[2] };
}

test('team has exactly 6 development and 6 verification agents', () => {
  assert.deepEqual(team.agents.filter(a => a.group === 'dev').map(a => a.id).sort(), [...DEV].sort());
  assert.deepEqual(team.agents.filter(a => a.group === 'verify').map(a => a.id).sort(), [...VERIFY].sort());
});

for (const id of [...DEV, ...VERIFY, 'orchestrator']) {
  test(`${id}: valid frontmatter and required sections`, () => {
    const { fm, body } = parse(`${id}.md`);
    assert.equal(fm.name, id);
    assert.ok(fm.description && fm.description.length > 40, 'description explains when to use the agent');
    assert.ok(VALID_MODELS.includes(fm.model), `model ${fm.model}`);
    const tools = fm.tools.split(',').map(t => t.trim());
    assert.ok(tools.every(t => VALID_TOOLS.includes(t)), `tools ${fm.tools}`);
    for (const s of REQUIRED_SECTIONS) assert.ok(body.includes(s), `missing section ${s}`);
  });
}

test('verification agents that run active tests reference the scope guard', () => {
  for (const id of ['sec-pentest', 'sec-red-team', 'sec-access-control', 'qa-load']) {
    assert.match(parse(`${id}.md`).body, /scope\.json/, id);
  }
});

test('read-only auditors cannot edit product code', () => {
  for (const id of ['sec-pentest', 'sec-auditor']) {
    const tools = parse(`${id}.md`).fm.tools;
    assert.doesNotMatch(tools, /\bEdit\b|\bWrite\b/, id);
  }
});

test('every stage has an owner and a fixer from the team', () => {
  const ids = new Set(team.agents.map(a => a.id));
  for (const s of team.stages) {
    assert.ok(ids.has(s.owner), `${s.id} owner ${s.owner}`);
    assert.ok(ids.has(s.fixer), `${s.id} fixer ${s.fixer}`);
    assert.ok(['static', 'active'].includes(s.kind), s.id);
  }
  for (const id of VERIFY) assert.ok(team.stages.some(s => s.owner === id), `${id} owns no stage`);
});

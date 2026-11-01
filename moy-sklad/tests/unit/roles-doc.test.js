'use strict';
// Keeps docs/architecture/roles.md and the access-control test matrix in sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROLES, MATRIX } = require('../e2e/role-matrix');

const doc = fs.readFileSync(path.resolve(__dirname, '../../docs/architecture/roles.md'), 'utf8');

function docTable() {
  const section = doc.split('## Проверяемые действия')[1].split('\n## ')[0];
  const rows = section.split('\n').filter(l => l.startsWith('|')).map(l => l.split('|').slice(1, -1).map(c => c.trim()));
  const [header, , ...body] = rows;
  return { header, body };
}

test('roles.md lists the same roles in the same order as the test matrix', () => {
  assert.deepEqual(docTable().header.slice(1), ROLES);
});

test('every action in roles.md matches the access-control test matrix', () => {
  const fromDoc = docTable().body.map(r => ({ action: r[0], expect: r.slice(1).map(Number) }));
  assert.deepEqual(fromDoc, MATRIX);
});

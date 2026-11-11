'use strict';
// Catalog rules of the mobile app. Runs with `node --experimental-strip-types` (unit stage).
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../../app/src/domain/catalog.ts');

const items = [{ id: 'p1', name: 'Укроп' }, { id: 'p2', name: 'Кинза свежая' }];

test('names are trimmed and inner spaces collapsed', () => {
  assert.deepEqual(catalog.checkName('  Руккола   бэби ', items), { ok: true, value: 'Руккола бэби' });
});

test('empty and overlong names are refused', () => {
  assert.equal(catalog.checkName('   ', items).ok, false);
  assert.equal(catalog.checkName('я'.repeat(81), items).ok, false);
  assert.equal(catalog.checkName('я'.repeat(80), items).ok, true);
});

test('a name used by another item is refused whatever the case or spacing', () => {
  assert.deepEqual(catalog.checkName('укроп', items), { ok: false, error: 'Такое название уже есть' });
  assert.equal(catalog.checkName('КИНЗА   свежая', items).ok, false);
  assert.equal(catalog.checkName('Укроп', items, 'p1').ok, true, 'renaming an item to its own name');
  assert.equal(catalog.checkName('Укроп', items, 'p2').ok, false);
});

test('unit and kind choices match the database enums', () => {
  assert.deepEqual(catalog.UNIT_OPTIONS.map(o => o.value), ['box', 'kg']);
  assert.deepEqual(catalog.KIND_OPTIONS.map(o => o.value), ['warehouse', 'market_point']);
});

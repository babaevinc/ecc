'use strict';
// Mobile app domain logic. Runs with `node --experimental-strip-types` (unit stage).
const test = require('node:test');
const assert = require('node:assert/strict');
const stock = require('../../app/src/domain/stock.ts');
const errors = require('../../app/src/domain/errors.ts');

const products = [
  { id: 'p1', name: 'Укроп', unit: 'box', sortOrder: 0, archived: false },
  { id: 'p2', name: 'Петрушка', unit: 'box', sortOrder: 1, archived: false },
  { id: 'p3', name: 'Кинза', unit: 'box', sortOrder: 2, archived: false },
  { id: 'p4', name: 'Базилик', unit: 'kg', sortOrder: 3, archived: false },
];
const b = (id, wh, prod, receivedOn, leftQty) => ({ id, warehouseId: wh, productId: prod, receivedOn, supplier: null, qty: leftQty, leftQty });
const batches = [
  b('b1', 'w1', 'p1', '2026-10-20', 4), b('b2', 'w1', 'p1', '2026-10-31', 12),
  b('b3', 'w1', 'p3', '2026-10-30', 35), b('b4', 'w2', 'p2', '2026-10-27', 16),
  b('b5', 'w2', 'p4', '2026-11-01', 0),
];
const TODAY = '2026-11-01';

test('home list: largest quantity first, empty batches ignored, oldest age per product', () => {
  const s = stock.summarizeByProduct(batches, products, TODAY);
  assert.deepEqual(s.map(x => [x.name, x.total, x.oldestAgeDays]), [['Кинза', 35, 2], ['Укроп', 16, 12], ['Петрушка', 16, 5]]);
});

test('equal quantities keep the owner importance order', () => {
  const s = stock.summarizeByProduct(batches, products, TODAY);
  assert.deepEqual(s.filter(x => x.total === 16).map(x => x.name), ['Укроп', 'Петрушка']);
});

test('warehouse filter', () => {
  assert.deepEqual(stock.summarizeByProduct(batches, products, TODAY, new Set(['w2'])).map(x => x.name), ['Петрушка']);
});

test('stale batches are 7+ days old and still in stock, oldest first', () => {
  assert.deepEqual(stock.staleBatches(batches, TODAY).map(x => x.id), ['b1']);
  assert.deepEqual(stock.staleBatches(batches, TODAY, 5).map(x => x.id), ['b1', 'b4']);
});

test('age in whole days across month boundaries', () => {
  assert.equal(stock.ageDays('2026-10-31', '2026-11-01'), 1);
  assert.equal(stock.ageDays('2026-11-01', '2026-11-01'), 0);
});

test('quantity input rules: whole boxes, kilograms up to 3 decimals, comma accepted', () => {
  assert.deepEqual(stock.parseQty('5', 'box'), { ok: true, value: 5 });
  assert.equal(stock.parseQty('2.5', 'box').ok, false);
  assert.deepEqual(stock.parseQty('1,25', 'kg'), { ok: true, value: 1.25 });
  assert.equal(stock.parseQty('0.0001', 'kg').ok, false);
  assert.equal(stock.parseQty('', 'box').ok, false);
  assert.equal(stock.parseQty('-3', 'box').ok, false);
  assert.equal(stock.parseQty('999999', 'box').ok, false);
});

test('−/+ stepper never goes below zero', () => {
  assert.equal(stock.stepQty('', 1), '1');
  assert.equal(stock.stepQty('1', -1), '');
  assert.equal(stock.stepQty('2,5', 1), '3.5');
});

test('quantities are formatted with Russian units', () => {
  assert.equal(stock.formatQty(16, 'box'), '16 кор.');
  assert.equal(stock.formatQty(1.25, 'kg'), '1,25 кг');
});

test('server error codes become short Russian messages, unknown ones fall back to the network hint', () => {
  assert.equal(errors.messageForCode('42501'), 'Недостаточно прав для этого действия');
  assert.equal(errors.messageForCode('invalid_credentials'), 'Неверный логин или пароль');
  assert.equal(errors.messageForCode('XX999'), errors.NETWORK_MESSAGE);
  assert.equal(errors.messageForCode(undefined), errors.NETWORK_MESSAGE);
});

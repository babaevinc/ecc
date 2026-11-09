'use strict';
// Shipping, sales and spoilage rules of the mobile app. Runs with `node --experimental-strip-types` (unit stage).
const test = require('node:test');
const assert = require('node:assert/strict');
const ops = require('../../app/src/domain/ops.ts');
const fifo = require('../../app/src/domain/fifo.ts');

test('cart merges the same product at the same price and never mutates the input', () => {
  const a = [{ productId: 'p1', qty: 2, price: 300 }];
  const b = ops.addToCart(a, { productId: 'p1', qty: 1.5, price: 300 });
  assert.deepEqual(b, [{ productId: 'p1', qty: 3.5, price: 300 }]);
  assert.deepEqual(a, [{ productId: 'p1', qty: 2, price: 300 }]);
  const c = ops.addToCart(b, { productId: 'p1', qty: 1, price: 250 });
  assert.equal(c.length, 2, 'a different price is a separate line');
  assert.deepEqual(ops.removeFromCart(c, 0), [{ productId: 'p1', qty: 1, price: 250 }]);
  assert.equal(ops.cartTotal(c), 1300);
  assert.equal(ops.cartTotal([{ productId: 'p1', qty: 3, price: null }]), 0);
});

test('stock check sums all lines of a product before comparing', () => {
  const lines = [{ productId: 'p1', qty: 3, price: 300 }, { productId: 'p1', qty: 2, price: 250 }, { productId: 'p2', qty: 1, price: null }];
  assert.deepEqual(ops.overStock(lines, id => (id === 'p1' ? 4 : 9)), { productId: 'p1', need: 5, available: 4 });
  assert.equal(ops.overStock(lines, () => 5), null);
});

test('prices are optional, accept a comma and keep kopecks only', () => {
  assert.deepEqual(ops.parsePrice(''), { ok: true, value: null });
  assert.deepEqual(ops.parsePrice('320,50'), { ok: true, value: 320.5 });
  assert.deepEqual(ops.parsePrice('1 200'), { ok: true, value: 1200 });
  assert.equal(ops.parsePrice('-1').ok, false);
  assert.equal(ops.parsePrice('10.555').ok, false);
  assert.equal(ops.parsePrice('abc').ok, false);
  assert.equal(ops.formatMoney(1234.5).replace(/\s/g, ' '), '1 234,5 ₽');
});

test('roles: managers create requests only, viewers nothing; managers cancel only their own', () => {
  assert.deepEqual(['owner', 'staff', 'manager', 'viewer'].map(r => [ops.can.request(r), ops.can.ship(r), ops.can.writeOff(r)]),
    [[true, true, true], [true, true, true], [true, false, false], [false, false, false]]);
  assert.equal(ops.can.cancelRequest('manager', true), true);
  assert.equal(ops.can.cancelRequest('manager', false), false);
  assert.equal(ops.can.cancelRequest('staff', false), true);
  assert.equal(ops.can.ship(null), false);
});

test('FIFO takes the oldest receipt first and refuses more than is left', () => {
  const batches = [
    { id: 'new', warehouseId: 'w1', productId: 'p1', receivedOn: '2026-11-08', leftQty: 5 },
    { id: 'old', warehouseId: 'w1', productId: 'p1', receivedOn: '2026-11-01', leftQty: 3 },
    { id: 'other', warehouseId: 'w2', productId: 'p1', receivedOn: '2026-10-01', leftQty: 9 },
  ];
  assert.deepEqual(fifo.planFifo(batches, 'w1', 'p1', 4.5), { ok: true, takes: [{ batchId: 'old', qty: 3 }, { batchId: 'new', qty: 1.5 }] });
  assert.deepEqual(fifo.planFifo(batches, 'w1', 'p1', 9), { ok: false, available: 8 });
  assert.equal(fifo.availableQty(batches, 'w1', 'p1'), 8);
});

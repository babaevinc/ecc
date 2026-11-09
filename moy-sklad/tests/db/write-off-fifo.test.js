'use strict';
/**
 * write_off_fifo on real PostgreSQL: spoilage by product takes the oldest batches first, in one
 * transaction, only for owner/staff of that warehouse; cancelling one row cancels the whole write-off.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, U, W1, W2, W9, P1, P9, B1, B2 } = require('./helpers');

const db = createTestDb();
if (!db) {
  test('write_off_fifo tests', { skip: 'MS_DB_URL is not set' }, () => {});
  return;
}
test.before(() => db.setup());
test.after(() => db.teardown());
const { value, code, as, left } = db;

const writeOff = (user, qty, reason = 'spoiled', note = 'null', wh = W1, prod = P1) =>
  `select public.write_off_fifo('${wh}', '${prod}', ${qty}, '${reason}', ${note});`;

test('takes the oldest batch first and spills into the next one, as one group', () => {
  const group = value(U.staff, writeOff(U.staff, 12, 'wilted', "'подвяло в жару'"));
  assert.equal(left(U.owner, B1), 0);
  assert.equal(left(U.owner, B2), 3);
  assert.equal(value(U.owner, `select count(*) || ':' || sum(qty) || ':' || bool_and(reason = 'wilted') || ':' || bool_and(note = 'подвяло в жару') from public.movements where group_id = '${group}';`), '2:12.000:true:true');

  const row = value(U.owner, `select id from public.movements where group_id = '${group}' limit 1;`);
  assert.ok(as(U.staff, `select public.void_movement('${row}');`).ok);
  assert.equal(left(U.owner, B1), 10, 'cancelling one row restores the whole write-off');
  assert.equal(left(U.owner, B2), 5);
});

test('refuses bad input without writing anything', () => {
  const before = value(U.owner, 'select count(*) from public.movements;');
  assert.equal(code(U.staff, writeOff(U.staff, 99)), '22023', 'more than in stock');
  assert.equal(code(U.staff, writeOff(U.staff, 0)), '22023');
  assert.equal(code(U.staff, writeOff(U.staff, 1, 'other')), '22023', '"other" needs a note');
  assert.equal(code(U.staff, writeOff(U.staff, 1, 'other', "'  '")), '22023');
  assert.equal(code(U.staff, writeOff(U.staff, 1, 'spoiled', 'null', W1, P9)), 'P0002', 'product of another company');
  assert.equal(value(U.owner, 'select count(*) from public.movements;'), before);
});

test('only owner and staff of that warehouse may write off', () => {
  assert.equal(code(U.viewer, writeOff(U.viewer, 1)), '42501');
  assert.equal(code(U.manager, writeOff(U.manager, 1)), '42501');
  assert.equal(code(U.staffW2, writeOff(U.staffW2, 1)), '42501', 'staff limited to another warehouse');
  assert.equal(code(U.owner2, writeOff(U.owner2, 1)), 'P0002', 'stranger sees nothing');
  assert.equal(code(U.owner, writeOff(U.owner, 1, 'spoiled', 'null', W9)), 'P0002', 'warehouse of another company');
  assert.equal(code(U.staffW2, writeOff(U.staffW2, 1, 'spoiled', 'null', W2)), '22023', 'allowed warehouse, but it is empty');
  assert.ok(as(U.owner, writeOff(U.owner, 1)).ok);
});

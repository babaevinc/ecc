'use strict';
/**
 * Database access tests: migrations + RLS + core stock functions on real PostgreSQL.
 * Needs MS_DB_URL pointing at an approved test server (see orchestrator/scope.json); skipped without it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, lines, U, C1, W1, P1, P2, P9, B1, B2, B9 } = require('./helpers');

const db = createTestDb();
if (!db) {
  test('database access tests', { skip: 'MS_DB_URL is not set' }, () => {});
  return;
}
test.before(() => db.setup());
test.after(() => db.teardown());
const { value, code, as, left } = db;

test('a company sees only its own stock; the platform admin sees all companies', () => {
  assert.equal(value(U.owner, `select count(*) from public.stock_batches;`), '2');
  assert.equal(value(U.owner2, `select count(*) from public.stock_batches;`), '1');
  assert.equal(value(U.owner2, `select count(*) from public.stock_batches where company_id = '${C1}';`), '0');
  assert.equal(value(U.owner, `select count(*) from public.companies;`), '1');
  assert.equal(value(U.admin, `select count(*) from public.companies;`), '2');
});

test('clients cannot write stock tables directly', () => {
  assert.equal(code(U.staff, `insert into public.batches (company_id, warehouse_id, product_id, qty, received_on, created_by) values ('${C1}', '${W1}', '${P1}', 1, current_date, '${U.staff}');`), '42501');
  assert.equal(code(U.owner, `update public.movements set qty = 1;`), '42501');
  assert.equal(code(U.owner, `delete from public.requests;`), '42501');
});

test('purchase price is hidden from staff and readable by the owner only through batch_costs()', () => {
  assert.equal(code(U.staff, `select unit_cost from public.batches;`), '42501');
  assert.equal(value(U.owner, `select unit_cost from public.batch_costs('${C1}') where batch_id = '${B1}';`), '500.00');
  assert.equal(code(U.staff, `select * from public.batch_costs('${C1}');`), '42501');
});

test('receive_stock follows the role matrix and hides other companies', () => {
  const call = `select public.receive_stock('${W1}', '${P2}', 3);`;
  assert.ok(as(U.owner, call).ok);
  assert.ok(as(U.staff, call).ok);
  assert.equal(code(U.manager, call), '42501');
  assert.equal(code(U.viewer, call), '42501');
  assert.equal(code(U.admin, call), '42501');
  assert.equal(code(U.owner2, call), 'P0002');
  assert.equal(code(U.staffW2, call), '42501', 'staff limited to warehouse 2');
  assert.equal(code(U.owner, `select public.receive_stock('${W1}', '${P1}', -1);`), '22023');
  assert.equal(code(U.owner, `select public.receive_stock('${W1}', '${P9}', 1);`), 'P0002', 'product of another company');
});

test('staff cannot set a purchase price', () => {
  const batch = value(U.staff, `select public.receive_stock('${W1}', '${P2}', 1, current_date, null, 999);`);
  assert.equal(value(U.owner, `select coalesce(unit_cost::text, 'null') from public.batch_costs('${C1}') where batch_id = '${batch}';`), 'null');
});

test('requests: created by a manager, shipped FIFO by staff, notifications go to the right people', () => {
  const req = value(U.manager, `select public.create_request('${W1}', ${lines(P1, 12)}, 'Кафе Лето');`);
  assert.equal(code(U.viewer, `select public.create_request('${W1}', ${lines(P1, 1)});`), '42501');
  assert.equal(code(U.manager, `select public.create_request('${W1}', '[]'::jsonb);`), '22023');

  assert.equal(value(U.owner, `select count(*) from public.notifications where kind = 'request_new';`), '1');
  assert.equal(value(U.staff, `select count(*) from public.notifications where kind = 'request_new';`), '1');
  assert.equal(value(U.manager, `select count(*) from public.notifications;`), '0', 'author is not notified');
  assert.equal(value(U.staffW2, `select count(*) from public.notifications;`), '0', 'staff of another warehouse is not notified');
  assert.equal(value(U.owner, `select payload ? 'price' from public.notifications limit 1;`), 'f');

  assert.equal(code(U.manager, `select public.ship_request('${req}');`), '42501');
  assert.equal(code(U.owner2, `select public.ship_request('${req}');`), 'P0002');
  assert.ok(as(U.staff, `select public.ship_request('${req}');`).ok);
  assert.equal(left(U.owner, B1), 0, 'oldest batch emptied first');
  assert.equal(left(U.owner, B2), 3);
  assert.equal(value(U.owner, `select status from public.requests where id = '${req}';`), 'done');
  assert.equal(code(U.staff, `select public.ship_request('${req}');`), '55000', 'cannot ship twice');
  assert.equal(value(U.manager, `select count(*) from public.notifications where kind = 'request_done';`), '1');
});

test('shipping more than the stock fails and changes nothing', () => {
  const req = value(U.owner, `select public.create_request('${W1}', ${lines(P1, 999)});`);
  const before = left(U.owner, B2);
  assert.equal(code(U.staff, `select public.ship_request('${req}');`), '22023');
  assert.equal(left(U.owner, B2), before);
  assert.equal(value(U.owner, `select status from public.requests where id = '${req}';`), 'new');
});

test('write_off: limits, reasons, other companies, and cancelling', () => {
  assert.equal(code(U.staff, `select public.write_off('${B2}', 100000, 'spoiled');`), '22023');
  assert.equal(code(U.staff, `select public.write_off('${B2}', 1, 'other');`), '22023', '"other" needs a note');
  assert.equal(code(U.staff, `select public.write_off('${B9}', 1, 'spoiled');`), 'P0002');
  assert.equal(code(U.viewer, `select public.write_off('${B2}', 1, 'spoiled');`), '42501');

  const before = left(U.owner, B2);
  assert.equal(Number(value(U.staff, `select public.write_off('${B2}', 1, 'wilted');`)), before - 1);
  const mov = value(U.staff, `select id from public.movements where batch_id = '${B2}' and kind = 'waste' order by created_at desc limit 1;`);
  assert.equal(code(U.viewer, `select public.void_movement('${mov}');`), '42501');
  assert.ok(as(U.staff, `select public.void_movement('${mov}');`).ok);
  assert.equal(left(U.owner, B2), before, 'cancelled write-off returns the stock');
  assert.equal(code(U.staff, `select public.void_movement('${mov}');`), '55000');
});

test('every stock change is in the audit log, readable by the owner only', () => {
  assert.ok(Number(value(U.owner, `select count(*) from public.audit_log where entity = 'movements';`)) > 0);
  assert.equal(value(U.staff, `select count(*) from public.audit_log;`), '0');
});

test('anonymous users get nothing', () => {
  const r = db.psql(`\\set VERBOSITY verbose\nset role anon;\nselect count(*) from public.stock_batches;\n`);
  assert.equal(r.ok, false);
  assert.match(r.err, /42501/);
});

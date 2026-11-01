'use strict';
/**
 * Stock operations on real PostgreSQL: request workflow, sales, moves, stock counts, stale-batch
 * notifications, and closed internal helpers. Needs MS_DB_URL; skipped without it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, lines, id, U, C1, W1, W2, W9 } = require('./helpers');

const db = createTestDb();
if (!db) {
  test('database operations tests', { skip: 'MS_DB_URL is not set' }, () => {});
  return;
}

// Extra fictional products so each test works on its own stock.
const SALE = id(311), MOVE = id(312), COUNT = id(313), SURPLUS = id(314), STALE = id(315);
test.before(() => {
  db.setup();
  db.admin(`insert into public.products (id, company_id, name) values
    ('${SALE}', '${C1}', 'Мята'), ('${MOVE}', '${C1}', 'Щавель'), ('${COUNT}', '${C1}', 'Базилик'),
    ('${SURPLUS}', '${C1}', 'Тархун'), ('${STALE}', '${C1}', 'Шпинат');`);
});
test.after(() => db.teardown());
const { value, code, as } = db;

const receive = (prod, qty, date) => value(U.owner, `select public.receive_stock('${W1}', '${prod}', ${qty}, '${date}');`);
const stockOf = (wh, prod) => Number(value(U.owner, `select coalesce(sum(left_qty), 0) from public.stock_batches where warehouse_id = '${wh}' and product_id = '${prod}';`));

test('request workflow: start, cancel by the right people, closed requests stay closed', () => {
  const mine = value(U.manager, `select public.create_request('${W1}', ${lines(SALE, 1)});`);
  const owners = value(U.owner, `select public.create_request('${W1}', ${lines(SALE, 1)});`);

  assert.equal(code(U.manager, `select public.start_request('${mine}');`), '42501');
  assert.ok(as(U.staff, `select public.start_request('${mine}');`).ok);
  assert.equal(value(U.owner, `select status from public.requests where id = '${mine}';`), 'in_progress');
  assert.equal(code(U.staff, `select public.start_request('${mine}');`), '55000', 'already started');

  assert.equal(code(U.manager, `select public.cancel_request('${owners}');`), '42501', 'manager cannot cancel others');
  assert.equal(code(U.owner2, `select public.cancel_request('${owners}');`), 'P0002');
  assert.ok(as(U.manager, `select public.cancel_request('${mine}');`).ok);
  assert.equal(value(U.owner, `select count(*) from public.notifications where kind = 'request_cancelled';`), '1');
  assert.equal(code(U.staff, `select public.ship_request('${mine}');`), '55000', 'cancelled cannot be shipped');
  assert.equal(code(U.owner, `select public.cancel_request('${mine}');`), '55000');
});

test('sale without a request: FIFO, markdown, cancel restores stock, no overselling', () => {
  receive(SALE, 4, '2026-10-25');
  receive(SALE, 6, '2026-10-29');
  const sale = value(U.staff, `select public.record_sale('${W1}', ${lines(SALE, 5, ',"price":300')}, true);`);
  assert.equal(stockOf(W1, SALE), 5);
  assert.equal(value(U.owner, `select count(*) || ':' || bool_and(markdown) || ':' || sum(qty) from public.movements where group_id = '${sale}';`), '2:true:5.000');

  assert.equal(code(U.viewer, `select public.record_sale('${W1}', ${lines(SALE, 1)});`), '42501');
  assert.equal(code(U.staff, `select public.record_sale('${W1}', ${lines(SALE, 99)});`), '22023');
  assert.equal(stockOf(W1, SALE), 5, 'failed sale changes nothing');
  assert.equal(code(U.staff, `select public.record_sale('${W1}', ${lines(SALE, 1, ',"price":-1')});`), '22023');

  const row = value(U.staff, `select id from public.movements where group_id = '${sale}' limit 1;`);
  assert.equal(code(U.manager, `select public.void_movement('${row}');`), '42501');
  assert.ok(as(U.staff, `select public.void_movement('${row}');`).ok);
  assert.equal(stockOf(W1, SALE), 10, 'cancelling one row cancels the whole sale');
});

test('move between warehouses keeps the batch receipt dates', () => {
  receive(MOVE, 8, '2026-10-15');
  receive(MOVE, 4, '2026-10-26');
  assert.equal(code(U.staffW2, `select public.move_stock('${W1}', '${W2}', '${MOVE}', 1);`), '42501', 'no access to source warehouse');
  assert.equal(code(U.staff, `select public.move_stock('${W1}', '${W1}', '${MOVE}', 1);`), '22023');
  assert.equal(code(U.staff, `select public.move_stock('${W1}', '${W9}', '${MOVE}', 1);`), 'P0002', 'warehouse of another company');
  assert.equal(code(U.owner2, `select public.move_stock('${W1}', '${W2}', '${MOVE}', 1);`), 'P0002');

  assert.ok(as(U.staff, `select public.move_stock('${W1}', '${W2}', '${MOVE}', 10);`).ok);
  assert.equal(stockOf(W1, MOVE), 2);
  assert.equal(stockOf(W2, MOVE), 10);
  assert.equal(value(U.owner, `select string_agg(received_on || '=' || qty, ',' order by received_on) from public.batches where warehouse_id = '${W2}' and product_id = '${MOVE}';`),
    '2026-10-15=8.000,2026-10-26=2.000');
  assert.equal(code(U.staff, `select public.move_stock('${W1}', '${W2}', '${MOVE}', 50);`), '22023');
});

test('stock count: staff submits, only the owner applies, with a reason', () => {
  receive(COUNT, 5, '2026-10-30');
  receive(SURPLUS, 2, '2026-10-30');
  const shortage = value(U.staff, `select public.submit_stock_count('${W1}', '[{"product_id":"${COUNT}","fact":3}]'::jsonb);`);
  assert.equal(value(U.owner, `select status from public.stock_counts where id = '${shortage}';`), 'pending');
  assert.equal(code(U.staff, `select public.apply_stock_count('${shortage}', true, 'пересчёт');`), '42501');
  assert.equal(code(U.owner, `select public.apply_stock_count('${shortage}', true, '  ');`), '22023');
  assert.ok(as(U.owner, `select public.apply_stock_count('${shortage}', true, 'недостача при пересчёте');`).ok);
  assert.equal(stockOf(W1, COUNT), 3);
  assert.equal(code(U.owner, `select public.apply_stock_count('${shortage}', true, 'ещё раз');`), '55000');

  const surplus = value(U.staff, `select public.submit_stock_count('${W1}', '[{"product_id":"${SURPLUS}","fact":5}]'::jsonb);`);
  assert.ok(as(U.owner, `select public.apply_stock_count('${surplus}', true, 'излишек');`).ok);
  assert.equal(stockOf(W1, SURPLUS), 5);

  const same = value(U.staff, `select public.submit_stock_count('${W1}', '[{"product_id":"${SURPLUS}","fact":5}]'::jsonb);`);
  assert.equal(value(U.owner, `select status from public.stock_counts where id = '${same}';`), 'applied', 'no differences — nothing to approve');

  const rejected = value(U.staff, `select public.submit_stock_count('${W1}', '[{"product_id":"${SURPLUS}","fact":0}]'::jsonb);`);
  assert.ok(as(U.owner, `select public.apply_stock_count('${rejected}', false, 'ошибка подсчёта');`).ok);
  assert.equal(stockOf(W1, SURPLUS), 5, 'rejected count changes nothing');
});

test('stale batches: owners and staff of that warehouse are notified once a day', () => {
  db.admin(`insert into public.batches (company_id, warehouse_id, product_id, qty, received_on, created_by)
            values ('${C1}', '${W1}', '${STALE}', 3, current_date - 8, '${U.owner}');`);
  const first = Number(db.admin(`select public.notify_stale_batches();`));
  assert.ok(first > 0);
  assert.equal(Number(db.admin(`select public.notify_stale_batches();`)), 0, 'no duplicates the same day');
  assert.equal(value(U.owner, `select count(*) > 0 from public.notifications where kind = 'batch_stale' and payload ->> 'product_id' = '${STALE}';`), 't');
  assert.equal(value(U.staff, `select count(*) > 0 from public.notifications where kind = 'batch_stale' and payload ->> 'product_id' = '${STALE}';`), 't');
  assert.equal(value(U.staffW2, `select count(*) from public.notifications where kind = 'batch_stale' and payload ->> 'product_id' = '${STALE}';`), '0',
    'staff of warehouse 2 is not notified about a warehouse 1 batch');
  assert.equal(value(U.staffW2, `select count(*) > 0 from public.notifications where kind = 'batch_stale' and payload ->> 'warehouse_id' = '${W2}';`), 't',
    'but is notified about the old batch moved to warehouse 2 (it keeps its receipt date)');
  assert.equal(value(U.manager, `select count(*) from public.notifications where kind = 'batch_stale';`), '0');
});

test('internal helpers cannot be called by clients', () => {
  assert.equal(code(U.owner, `select public.notify_stale_batches();`), '42501');
  assert.equal(code(U.owner, `select * from public.take_fifo('${C1}', '${W1}', '${SALE}', 1, null, 'sale', 0, false, null, null, null);`), '42501');
  assert.equal(code(U.owner, `select public.require_role('${C1}', array['owner']::public.member_role[]);`), '42501');
});

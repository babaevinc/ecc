'use strict';
/**
 * Database access tests: migrations + RLS + stock functions on real PostgreSQL.
 * Needs MS_DB_URL pointing at an approved test server (see orchestrator/scope.json); each run creates
 * and drops its own throwaway database. Skipped when MS_DB_URL is not set.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const guard = require('../../orchestrator/guard');

const SERVER = process.env.MS_DB_URL;
if (!SERVER) {
  test('database tests', { skip: 'MS_DB_URL is not set' }, () => {});
  return;
}

const env = guard.checkEnv(process.env, guard.loadScope());
if (!env.ok) throw new Error(`refusing to run database tests: ${env.reasons.join('; ')}`);

const SUPA = path.resolve(__dirname, '../../backend/supabase');
const DB_NAME = `ms_rls_${process.pid}_${Date.now()}`;
const dbUrl = (() => { const u = new URL(SERVER); u.pathname = `/${DB_NAME}`; return u.toString(); })();

function psql(url, input) {
  const r = spawnSync('psql', [url, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function must(url, input) {
  const r = psql(url, input);
  if (!r.ok) throw new Error(r.err);
  return r.out;
}

// fixed ids for readability
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { admin: id(1), owner: id(2), staff: id(3), manager: id(4), viewer: id(5), owner2: id(6), staffW2: id(7) };
const C1 = id(101), C2 = id(102);
const W1 = id(201), W2 = id(202), W9 = id(209);
const P1 = id(301), P2 = id(302), P9 = id(309);
const B1 = id(401), B2 = id(402), B9 = id(409);

/** Run SQL as a signed-in user through RLS. Returns { ok, out, code, err }. */
function as(user, sql) {
  const r = psql(dbUrl, `\\set VERBOSITY verbose\nbegin;\nset local role authenticated;\nset local request.jwt.claim.sub = '${user}';\n${sql}\ncommit;\n`);
  const m = /ERROR:\s+([0-9A-Z]{5}):/.exec(r.err);
  return { ...r, code: m ? m[1] : null };
}

function value(user, sql) {
  const r = as(user, sql);
  assert.ok(r.ok, r.err);
  return r.out;
}

function code(user, sql) {
  const r = as(user, sql);
  assert.equal(r.ok, false, `expected an error, got: ${r.out}`);
  return r.code;
}

test.before(() => {
  must(SERVER, `create database ${DB_NAME};`);
  must(dbUrl, fs.readFileSync(path.join(SUPA, 'tests/local-auth-shim.sql'), 'utf8'));
  for (const f of fs.readdirSync(path.join(SUPA, 'migrations')).sort()) must(dbUrl, fs.readFileSync(path.join(SUPA, 'migrations', f), 'utf8'));
  must(dbUrl, `
    insert into auth.users (id) select unnest(array['${Object.values(U).join("','")}']::uuid[]);
    insert into public.platform_admins values ('${U.admin}');
    insert into public.companies (id, name) values ('${C1}', 'Тестовая 1'), ('${C2}', 'Тестовая 2');
    insert into public.members (company_id, user_id, role, warehouse_ids) values
      ('${C1}', '${U.owner}', 'owner', '{}'), ('${C1}', '${U.staff}', 'staff', '{}'),
      ('${C1}', '${U.manager}', 'manager', '{}'), ('${C1}', '${U.viewer}', 'viewer', '{}'),
      ('${C1}', '${U.staffW2}', 'staff', '{${W2}}'), ('${C2}', '${U.owner2}', 'owner', '{}');
    insert into public.warehouses (id, company_id, name) values ('${W1}', '${C1}', 'Склад 1'), ('${W2}', '${C1}', 'Склад 2'), ('${W9}', '${C2}', 'Склад 9');
    insert into public.products (id, company_id, name) values ('${P1}', '${C1}', 'Укроп'), ('${P2}', '${C1}', 'Кинза'), ('${P9}', '${C2}', 'Петрушка');
    insert into public.batches (id, company_id, warehouse_id, product_id, qty, received_on, unit_cost, created_by, created_at) values
      ('${B1}', '${C1}', '${W1}', '${P1}', 10, '2026-10-20', 500, '${U.owner}', now() - interval '2 hours'),
      ('${B2}', '${C1}', '${W1}', '${P1}', 5, '2026-10-28', 600, '${U.owner}', now() - interval '1 hour'),
      ('${B9}', '${C2}', '${W9}', '${P9}', 25, '2026-10-27', 300, '${U.owner2}', now());
  `);
});

test.after(() => { psql(SERVER, `drop database if exists ${DB_NAME} with (force);`); });

const left = (user, batch) => Number(value(user, `select left_qty from public.stock_batches where id = '${batch}';`));
const lines = (prod, qty) => `'[{"product_id":"${prod}","qty":${qty}}]'::jsonb`;

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
  const r = psql(dbUrl, `\\set VERBOSITY verbose\nset role anon;\nselect count(*) from public.stock_batches;\n`);
  assert.equal(r.ok, false);
  assert.match(r.err, /42501/);
});

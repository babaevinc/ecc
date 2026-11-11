'use strict';
/**
 * Catalog management on real PostgreSQL: only the owner adds, renames, archives and deletes products
 * and warehouses; the guards keep the books consistent (unit, stock, history, last owner).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, id, U, C1, W1, W2, P1, P2 } = require('./helpers');

const db = createTestDb();
if (!db) {
  test('catalog tests', { skip: 'MS_DB_URL is not set' }, () => {});
  return;
}
test.before(() => db.setup());
test.after(() => db.teardown());
const { value, code, as } = db;
const NEW_P = id(350), NEW_W = id(250);

test('only the owner of the company adds products and warehouses; names are unique', () => {
  const addProduct = `insert into public.products (id, company_id, name, unit) values ('${NEW_P}', '${C1}', 'Руккола', 'kg');`;
  const addWarehouse = `insert into public.warehouses (id, company_id, name, kind) values ('${NEW_W}', '${C1}', 'Склад 3', 'market_point');`;
  for (const user of [U.staff, U.manager, U.viewer, U.owner2]) {
    assert.equal(code(user, addProduct), '42501');
    assert.equal(code(user, addWarehouse), '42501');
  }
  assert.ok(as(U.owner, addProduct).ok);
  assert.ok(as(U.owner, addWarehouse).ok);
  assert.equal(code(U.owner, `insert into public.products (company_id, name) values ('${C1}', 'Руккола');`), '23505');
  assert.equal(code(U.owner, `insert into public.warehouses (company_id, name) values ('${C1}', 'Склад 3');`), '23505');
  assert.equal(code(U.owner, `insert into public.products (company_id, name) values ('${C1}', '');`), '23514', 'empty name');
});

test('staff cannot rename, archive or delete: their writes touch nothing', () => {
  as(U.staff, `update public.products set name = 'Взлом' where id = '${P2}';`);
  as(U.staff, `delete from public.products where id = '${NEW_P}';`);
  as(U.manager, `update public.warehouses set archived = true where id = '${W2}';`);
  assert.equal(value(U.owner, `select name from public.products where id = '${P2}';`), 'Кинза');
  assert.equal(value(U.owner, `select count(*) from public.products where id = '${NEW_P}';`), '1');
  assert.equal(value(U.owner, `select archived from public.warehouses where id = '${W2}';`), 'f');
});

test('unit is frozen once a product has batches; rename always works', () => {
  assert.equal(code(U.owner, `update public.products set unit = 'kg' where id = '${P1}';`), '55000');
  assert.ok(as(U.owner, `update public.products set unit = 'kg' where id = '${P2}';`).ok, 'no batches yet');
  assert.ok(as(U.owner, `update public.products set name = 'Укроп свежий' where id = '${P1}';`).ok);
});

test('stock must be gone before archiving; history blocks deletion', () => {
  assert.equal(code(U.owner, `update public.products set archived = true where id = '${P1}';`), '55000');
  assert.equal(code(U.owner, `update public.warehouses set archived = true where id = '${W1}';`), '55000');
  assert.ok(as(U.owner, `update public.products set archived = true where id = '${P2}';`).ok);
  assert.ok(as(U.owner, `update public.warehouses set archived = true where id = '${W2}';`).ok);
  assert.ok(as(U.owner, `update public.warehouses set archived = false where id = '${W2}';`).ok, 'can be restored');

  assert.equal(code(U.owner, `delete from public.products where id = '${P1}';`), '23503');
  assert.equal(code(U.owner, `delete from public.warehouses where id = '${W1}';`), '23503');
  assert.ok(as(U.owner, `delete from public.products where id = '${NEW_P}';`).ok, 'unused product');
  assert.ok(as(U.owner, `delete from public.warehouses where id = '${NEW_W}';`).ok, 'unused warehouse');
  assert.equal(value(U.owner, `select count(*) from public.products where id = '${NEW_P}';`), '0');
});

test('a company always keeps an owner', () => {
  assert.equal(code(U.owner, `update public.members set role = 'staff' where company_id = '${C1}' and user_id = '${U.owner}';`), '55000');
  assert.equal(code(U.owner, `delete from public.members where company_id = '${C1}' and user_id = '${U.owner}';`), '55000');
  assert.ok(as(U.owner, `update public.members set role = 'owner' where company_id = '${C1}' and user_id = '${U.staff}';`).ok);
  assert.ok(as(U.owner, `update public.members set role = 'staff' where company_id = '${C1}' and user_id = '${U.owner}';`).ok, 'another owner exists now');
  assert.equal(value(U.staff, `select count(*) from public.members where company_id = '${C1}' and role = 'owner';`), '1');
});

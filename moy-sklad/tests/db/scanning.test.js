'use strict';
/** Label scanning on real PostgreSQL: supplier barcodes and registered scanners. Needs MS_DB_URL. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, U, C1, W1, W9, P1, P2, P9 } = require('./helpers');

const db = createTestDb();
if (!db) {
  test('database scanning tests', { skip: 'MS_DB_URL is not set' }, () => {});
  return;
}
test.before(() => db.setup());
test.after(() => db.teardown());
const { value, code, as } = db;

const EAN = '4601234567893';
const link = (code_, prod) => `insert into public.product_barcodes (company_id, code, product_id) values ('${C1}', '${code_}', '${prod}');`;

test('owner and staff link supplier barcodes to their own products', () => {
  assert.ok(as(U.staff, link(EAN, P1)).ok);
  assert.equal(code(U.viewer, link('4600000000008', P2)), '42501');
  assert.equal(code(U.manager, link('4600000000008', P2)), '42501');
  assert.equal(code(U.staff, link('4600000000008', P9)), '42501', 'product of another company');
  assert.equal(code(U.owner, link(EAN, P2)), '23505', 'one code points to one product');
  assert.equal(code(U.staff, link('bad code!', P2)), '23514', 'only printable barcode characters');
  assert.equal(value(U.manager, `select product_id from public.product_barcodes where code = '${EAN}';`), P1);
  assert.equal(value(U.owner2, `select count(*) from public.product_barcodes;`), '0', 'another company sees nothing');
});

test('only the owner unlinks a barcode', () => {
  as(U.staff, `delete from public.product_barcodes where code = '${EAN}';`);
  assert.equal(value(U.owner, `select count(*) from public.product_barcodes;`), '1', 'staff delete changes nothing');
  assert.ok(as(U.owner, `delete from public.product_barcodes where code = '${EAN}';`).ok);
  assert.equal(value(U.owner, `select count(*) from public.product_barcodes;`), '0');
});

test('only the owner registers scanners, within the company', () => {
  const add = (name, wh) => `insert into public.scanners (company_id, name, kind, suffix, warehouse_id) values ('${C1}', '${name}', 'keyboard', '', ${wh ? `'${wh}'` : 'null'}) returning id;`;
  const id = value(U.owner, add('Сканер склада 1', W1));
  assert.equal(code(U.staff, add('Свой сканер')), '42501');
  assert.equal(code(U.owner, add('Чужой склад', W9)), '42501', 'warehouse of another company');
  assert.equal(code(U.owner, add('Сканер склада 1', null)), '23505', 'names are unique');

  assert.equal(value(U.viewer, `select name from public.scanners;`), 'Сканер склада 1', 'everyone in the company sees scanners');
  as(U.staff, `update public.scanners set name = 'Переименован' where id = '${id}';`);
  assert.equal(value(U.owner, `select name from public.scanners where id = '${id}';`), 'Сканер склада 1', 'staff cannot rename');

  assert.ok(as(U.staff, `select public.mark_scanner_seen('${id}');`).ok, 'any member can record a successful test scan');
  assert.equal(value(U.owner, `select last_seen_at is not null from public.scanners where id = '${id}';`), 't');
  assert.equal(code(U.owner2, `select public.mark_scanner_seen('${id}');`), 'P0002');
  assert.equal(code(U.owner, `update public.scanners set created_by = '${U.staff}' where id = '${id}';`), '42501', 'author cannot be rewritten');
});

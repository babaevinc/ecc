'use strict';
/** Push delivery on real PostgreSQL: token registration rules and the server-only claim/forget functions. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb, lines, U, W1, P1 } = require('./helpers');

const db = createTestDb();
if (!db) {
  test('database push tests', { skip: 'MS_DB_URL is not set' }, () => {});
  return;
}
test.before(() => db.setup());
test.after(() => db.teardown());
const { value, code, as } = db;

test('users register only their own device tokens', () => {
  assert.ok(as(U.owner, `insert into public.push_tokens (user_id, token, platform) values ('${U.owner}', 'ExponentPushToken[owner-1]', 'ios'), ('${U.owner}', 'ExponentPushToken[owner-2]', 'android');`).ok);
  assert.ok(as(U.staff, `insert into public.push_tokens (user_id, token, platform) values ('${U.staff}', 'ExponentPushToken[staff-1]', 'android');`).ok);
  assert.equal(code(U.staff, `insert into public.push_tokens (user_id, token, platform) values ('${U.owner}', 'ExponentPushToken[spoof]', 'ios');`), '42501');
  assert.equal(value(U.staff, `select count(*) from public.push_tokens;`), '1', 'staff sees only their own tokens');
});

test('claim_push_batch returns one row per device with names, and never twice', () => {
  value(U.manager, `select public.create_request('${W1}', ${lines(P1, 2)}, 'Кафе Лето');`);
  const rows = JSON.parse(db.admin(`select coalesce(json_agg(r order by r.token), '[]') from public.claim_push_batch(500) r;`));
  assert.deepEqual(rows.map(r => r.token), ['ExponentPushToken[owner-1]', 'ExponentPushToken[owner-2]', 'ExponentPushToken[staff-1]']);
  assert.equal(rows[0].kind, 'request_new');
  assert.deepEqual(rows[0].details, { number: 1, warehouse: 'Склад 1', client: 'Кафе Лето' });
  assert.equal(db.admin(`select count(*) from public.claim_push_batch(500);`), '0', 'already claimed');
  assert.equal(value(U.owner, `select count(*) from public.notifications where pushed_at is not null;`), '1', 'the in-app feed keeps the row');
});

test('forget_push_token removes a dead device', () => {
  assert.equal(db.admin(`select public.forget_push_token('ExponentPushToken[owner-2]');`), '1');
  assert.equal(value(U.owner, `select count(*) from public.push_tokens;`), '1');
});

test('clients cannot claim or delete other people\'s push data', () => {
  assert.equal(code(U.owner, `select * from public.claim_push_batch(10);`), '42501');
  assert.equal(code(U.owner, `select public.forget_push_token('ExponentPushToken[staff-1]');`), '42501');
});

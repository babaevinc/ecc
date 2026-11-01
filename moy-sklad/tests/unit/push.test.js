'use strict';
// Runs with `node --experimental-strip-types` (see the unit stage in orchestrator/team.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const push = require('../../backend/supabase/functions/_shared/push.ts');

const NOW = new Date('2026-11-01T05:00:00Z');
const TOKEN = 'ExponentPushToken[abc123]';

test('lock-screen texts per kind, without prices', () => {
  assert.deepEqual(push.textFor('request_new', { number: 7, warehouse: 'Склад 1', client: 'Кафе Лето' }, NOW),
    { title: 'Новая заявка №7', body: 'Склад 1 · Кафе Лето' });
  assert.equal(push.textFor('request_done', { number: 7, warehouse: 'Склад 1' }, NOW).title, 'Заявка №7 отгружена');
  assert.equal(push.textFor('request_cancelled', { number: 8 }, NOW).body, 'Откройте приложение');
  assert.deepEqual(push.textFor('batch_stale', { product: 'Укроп', warehouse: 'Склад 1', unit: 'box', received_on: '2026-10-20', left_qty: 3 }, NOW),
    { title: 'Партия лежит 12 дн.', body: 'Укроп · Склад 1 · осталось 3 кор.' });
  assert.equal(push.textFor('batch_stale', { unit: 'kg', left_qty: 1.5 }, NOW).body, 'осталось 1,5 кг');
  assert.equal(push.textFor('unknown_kind', {}, NOW), null);
});

test('only real Expo tokens and known kinds become messages', () => {
  const rows = [
    { notification_id: 'n1', token: TOKEN, kind: 'request_new', payload: { request_id: 'r1', price: 999 }, details: { number: 1 } },
    { notification_id: 'n2', token: 'not-a-token', kind: 'request_new', payload: {}, details: {} },
    { notification_id: 'n3', token: TOKEN, kind: 'something_else', payload: {}, details: {} },
  ];
  const { messages, skipped } = push.buildMessages(rows, NOW);
  assert.equal(skipped, 2);
  assert.deepEqual(messages, [{
    to: TOKEN, title: 'Новая заявка №1', body: 'Откройте приложение',
    data: { kind: 'request_new', notification_id: 'n1', request_id: 'r1' }, sound: 'default', priority: 'high',
  }]);
  assert.equal(JSON.stringify(messages).includes('999'), false, 'payload fields other than ids are not forwarded');
});

test('messages are sent in chunks of at most 100', () => {
  assert.deepEqual(push.chunk([...Array(250).keys()]).map(c => c.length), [100, 100, 50]);
  assert.deepEqual(push.chunk([]), []);
});

test('DeviceNotRegistered tickets name the tokens to forget', () => {
  const messages = [{ to: 'ExpoPushToken[a]' }, { to: 'ExpoPushToken[b]' }, { to: 'ExpoPushToken[c]' }];
  const tickets = [
    { status: 'ok', id: '1' },
    { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
  ];
  assert.deepEqual(push.deadTokens(messages, tickets), ['ExpoPushToken[b]']);
});

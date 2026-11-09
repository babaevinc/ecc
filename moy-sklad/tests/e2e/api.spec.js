// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('health check answers', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});

test('every response carries security headers', async ({ request }) => {
  const res = await request.get('/health');
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['content-security-policy']).toContain("default-src 'none'");
  expect(h['cache-control']).toBe('no-store');
  expect(h['x-powered-by']).toBeUndefined();
});

test('staff signs in, receives stock and sees it in the list', async ({ request }) => {
  const headers = await login(request, 'test-staff');
  const me = await (await request.get('/api/me', { headers })).json();
  expect(me).toEqual({ login: 'test-staff', role: 'staff', company: 'c1' });

  const add = await request.post('/api/batches', { headers, data: { prod: 'Базилик', wh: 'w1', qty: 6 } });
  expect(add.status()).toBe(201);
  const { items } = await (await request.get('/api/batches', { headers })).json();
  expect(items.some(b => b.prod === 'Базилик' && b.left === 6)).toBe(true);
});

test('request is created by a manager and shipped by staff', async ({ request }) => {
  const manager = await login(request, 'test-manager');
  const created = await request.post('/api/requests', { headers: manager, data: { lines: [{ prod: 'Кинза', qty: 3 }] } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  const staff = await login(request, 'test-staff');
  const shipped = await request.post(`/api/requests/${id}/ship`, { headers: staff });
  expect(shipped.status()).toBe(200);
  expect((await shipped.json()).status).toBe('done');

  const again = await request.post(`/api/requests/${id}/ship`, { headers: staff });
  expect(again.status()).toBe(409);
});

test('spoilage write-off reduces the batch', async ({ request }) => {
  const headers = await login(request, 'test-owner');
  const before = (await (await request.get('/api/batches', { headers })).json()).items.find(b => b.id === 'b2');
  const res = await request.post('/api/waste', { headers, data: { batch: 'b2', qty: 2, reason: 'spoiled' } });
  expect(res.status()).toBe(201);
  expect((await res.json()).left).toBe(before.left - 2);
});

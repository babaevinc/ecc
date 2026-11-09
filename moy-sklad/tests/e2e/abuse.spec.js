// @ts-check
// Red Team abuse cases. Test stand only (orchestrator/scope.json); fictional accounts only.
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test('password guessing is throttled after 5 failures', async ({ request }) => {
  const codes = [];
  for (let i = 0; i < 6; i++) {
    codes.push((await request.post('/auth/login', { data: { login: 'test-bruteforce', password: `guess-${i}` } })).status());
  }
  expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
  expect(codes[5]).toBe(429);
});

test('unknown login and wrong password look the same', async ({ request }) => {
  const a = await request.post('/auth/login', { data: { login: 'test-staff', password: 'wrong' } });
  const b = await request.post('/auth/login', { data: { login: 'no-such-user', password: 'wrong' } });
  expect(a.status()).toBe(401);
  expect(await a.json()).toEqual(await b.json());
});

test('tampered and logged-out tokens are rejected', async ({ request }) => {
  const headers = await login(request, 'test-staff');
  const tampered = { Authorization: headers.Authorization.slice(0, -1) + (headers.Authorization.endsWith('a') ? 'b' : 'a') };
  expect((await request.get('/api/me', { headers: tampered })).status()).toBe(401);
  expect((await request.post('/auth/logout', { headers })).status()).toBe(204);
  expect((await request.get('/api/me', { headers })).status()).toBe(401);
});

test('staff cannot hide theft by writing off more than the batch holds', async ({ request }) => {
  const headers = await login(request, 'test-staff');
  const res = await request.post('/api/waste', { headers, data: { batch: 'b1', qty: 100000, reason: 'spoiled' } });
  expect(res.status()).toBe(400);
});

test('write-off of another company batch is not found', async ({ request }) => {
  const headers = await login(request, 'test-staff');
  expect((await request.post('/api/waste', { headers, data: { batch: 'b3', qty: 1, reason: 'spoiled' } })).status()).toBe(404);
});

test('oversized and non-JSON bodies are refused', async ({ request }) => {
  const headers = await login(request, 'test-staff');
  const big = await request.post('/api/requests', { headers, data: { lines: [{ prod: 'x'.repeat(20000), qty: 1 }] } });
  expect(big.status()).toBe(413);
  const form = await request.post('/api/batches', { headers: { ...headers, 'Content-Type': 'text/plain' }, data: 'prod=1' });
  expect(form.status()).toBe(415);
});

test('injection-shaped input is treated as data, errors leak nothing', async ({ request }) => {
  const headers = await login(request, 'test-staff');
  const res = await request.post('/api/batches', { headers, data: { prod: "' OR 1=1 --", wh: 'w1', qty: -1 } });
  expect(res.status()).toBe(400);
  const text = await res.text();
  expect(text).not.toMatch(/at\s+\w+\s+\(|stack|sql|syntax/i);
});

// @ts-check
// Role × action matrix. Source of truth: docs/architecture/roles.md (keep both in sync).
const { test, expect } = require('@playwright/test');
const { login, createRequest } = require('./helpers');

const ROLES = ['test-superadmin', 'test-owner', 'test-staff', 'test-manager', 'test-viewer'];

/** expected status per role, in ROLES order */
const MATRIX = [
  { action: 'list batches', expect: [200, 200, 200, 200, 200], run: (r, h) => r.get('/api/batches', { headers: h }) },
  { action: 'receive stock', expect: [403, 201, 201, 403, 403], run: (r, h) => r.post('/api/batches', { headers: h, data: { prod: 'Щавель', wh: 'w1', qty: 1 } }) },
  { action: 'create request', expect: [403, 201, 201, 201, 403], run: (r, h) => r.post('/api/requests', { headers: h, data: { lines: [{ prod: 'Укроп', qty: 1 }] } }) },
  { action: 'write off spoilage', expect: [403, 201, 201, 403, 403], run: (r, h) => r.post('/api/waste', { headers: h, data: { batch: 'b1', qty: 1, reason: 'spoiled' } }) },
  { action: 'view finance', expect: [200, 200, 403, 403, 403], run: (r, h) => r.get('/api/finance', { headers: h }) },
  { action: 'list all companies', expect: [200, 403, 403, 403, 403], run: (r, h) => r.get('/api/admin/companies', { headers: h }) },
];

for (const row of MATRIX) {
  ROLES.forEach((role, i) => {
    test(`${role} → ${row.action} = ${row.expect[i]}`, async ({ request }) => {
      const headers = await login(request, role);
      const res = await row.run(request, headers);
      expect(res.status()).toBe(row.expect[i]);
    });
  });
}

test('ship request: only owner and staff of the same company', async ({ request }) => {
  const owner = await login(request, 'test-owner');
  // another company gets 404, not 403, so it cannot even learn that the request exists
  for (const [role, status] of [['test-manager', 403], ['test-viewer', 403], ['test-owner-2', 404], ['test-staff', 200]]) {
    const id = await createRequest(request, owner);
    const res = await request.post(`/api/requests/${id}/ship`, { headers: await login(request, role) });
    expect(res.status(), role).toBe(status);
  }
});

test('another company sees none of our batches', async ({ request }) => {
  const other = await login(request, 'test-owner-2');
  const { items } = await (await request.get('/api/batches', { headers: other })).json();
  expect(items.every(b => b.wh === 'w9')).toBe(true);
});

test('anonymous requests are refused', async ({ request }) => {
  for (const path of ['/api/me', '/api/batches', '/api/finance', '/api/admin/companies']) {
    expect((await request.get(path)).status(), path).toBe(401);
  }
});

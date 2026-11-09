// @ts-check
// Role × action matrix. Source of truth: docs/architecture/roles.md (tests/unit/roles-doc.test.js keeps them in sync).
const { test, expect } = require('@playwright/test');
const { login, createRequest } = require('./helpers');
const { ROLES, MATRIX } = require('./role-matrix');

/** how each action in the matrix is performed against the test API */
const RUN = {
  'list batches': (r, h) => r.get('/api/batches', { headers: h }),
  'receive stock': (r, h) => r.post('/api/batches', { headers: h, data: { prod: 'Щавель', wh: 'w1', qty: 1 } }),
  'create request': (r, h) => r.post('/api/requests', { headers: h, data: { lines: [{ prod: 'Укроп', qty: 1 }] } }),
  'write off spoilage': (r, h) => r.post('/api/waste', { headers: h, data: { batch: 'b1', qty: 1, reason: 'spoiled' } }),
  'view finance': (r, h) => r.get('/api/finance', { headers: h }),
  'list all companies': (r, h) => r.get('/api/admin/companies', { headers: h }),
};

for (const row of MATRIX) {
  ROLES.forEach((role, i) => {
    test(`${role} → ${row.action} = ${row.expect[i]}`, async ({ request }) => {
      const run = RUN[row.action];
      expect(run, `no request defined for "${row.action}"`).toBeTruthy();
      const res = await run(request, await login(request, `test-${role}`));
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

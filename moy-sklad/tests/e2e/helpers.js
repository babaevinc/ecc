'use strict';
const { expect } = require('@playwright/test');
const { TEST_PASSWORD } = require('../../backend/test-api/fixtures');

async function login(request, login, password = TEST_PASSWORD) {
  const res = await request.post('/auth/login', { data: { login, password } });
  expect(res.status(), `login as ${login}`).toBe(200);
  const { token } = await res.json();
  return { Authorization: `Bearer ${token}` };
}

async function createRequest(request, headers) {
  const res = await request.post('/api/requests', { headers, data: { lines: [{ prod: 'Укроп', qty: 1 }] } });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

module.exports = { login, createRequest, TEST_PASSWORD };

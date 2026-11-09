'use strict';
// Fictional test accounts and data. Never put real people, prices or clients here.
const TEST_PASSWORD = process.env.MS_TEST_PASSWORD || 'test-only-Passw0rd';

const USERS = [
  { login: 'test-superadmin', role: 'superadmin', company: null },
  { login: 'test-owner', role: 'owner', company: 'c1' },
  { login: 'test-staff', role: 'staff', company: 'c1' },
  { login: 'test-manager', role: 'manager', company: 'c1' },
  { login: 'test-viewer', role: 'viewer', company: 'c1' },
  { login: 'test-owner-2', role: 'owner', company: 'c2' },
  { login: 'test-bruteforce', role: 'viewer', company: 'c1' },
];

const COMPANIES = [
  { id: 'c1', name: 'Тестовая компания 1' },
  { id: 'c2', name: 'Тестовая компания 2' },
];

const BATCHES = [
  { id: 'b1', company: 'c1', wh: 'w1', prod: 'Укроп', qty: 10, date: '2026-10-20' },
  { id: 'b2', company: 'c1', wh: 'w1', prod: 'Кинза', qty: 40, date: '2026-10-28' },
  { id: 'b3', company: 'c2', wh: 'w9', prod: 'Петрушка', qty: 25, date: '2026-10-27' },
];

module.exports = { TEST_PASSWORD, USERS, COMPANIES, BATCHES };

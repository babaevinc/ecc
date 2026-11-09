'use strict';
/**
 * Shared harness for database tests: creates a throwaway database on the approved test server
 * (MS_DB_URL), applies the local auth shim + all migrations, loads fictional fixtures, and runs SQL
 * as a signed-in user through RLS.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const guard = require('../../orchestrator/guard');

const SUPA = path.resolve(__dirname, '../../backend/supabase');

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const U = { admin: id(1), owner: id(2), staff: id(3), manager: id(4), viewer: id(5), owner2: id(6), staffW2: id(7) };
const C1 = id(101), C2 = id(102);
const W1 = id(201), W2 = id(202), W9 = id(209);
const P1 = id(301), P2 = id(302), P9 = id(309);
const B1 = id(401), B2 = id(402), B9 = id(409);

function psql(url, input) {
  const r = spawnSync('psql', [url, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function must(url, input) {
  const r = psql(url, input);
  if (!r.ok) throw new Error(r.err);
  return r.out;
}

const FIXTURES = `
  insert into auth.users (id) select unnest(array['${Object.values(U).join("','")}']::uuid[]);
  insert into public.platform_admins values ('${U.admin}');
  insert into public.companies (id, name) values ('${C1}', 'Тестовая 1'), ('${C2}', 'Тестовая 2');
  insert into public.members (company_id, user_id, role, warehouse_ids) values
    ('${C1}', '${U.owner}', 'owner', '{}'), ('${C1}', '${U.staff}', 'staff', '{}'),
    ('${C1}', '${U.manager}', 'manager', '{}'), ('${C1}', '${U.viewer}', 'viewer', '{}'),
    ('${C1}', '${U.staffW2}', 'staff', '{${W2}}'), ('${C2}', '${U.owner2}', 'owner', '{}');
  insert into public.warehouses (id, company_id, name) values ('${W1}', '${C1}', 'Склад 1'), ('${W2}', '${C1}', 'Склад 2'), ('${W9}', '${C2}', 'Склад 9');
  insert into public.products (id, company_id, name) values ('${P1}', '${C1}', 'Укроп'), ('${P2}', '${C1}', 'Кинза'), ('${P9}', '${C2}', 'Петрушка');
  insert into public.batches (id, company_id, warehouse_id, product_id, qty, received_on, unit_cost, created_by, created_at) values
    ('${B1}', '${C1}', '${W1}', '${P1}', 10, '2026-10-20', 500, '${U.owner}', now() - interval '2 hours'),
    ('${B2}', '${C1}', '${W1}', '${P1}', 5, '2026-10-28', 600, '${U.owner}', now() - interval '1 hour'),
    ('${B9}', '${C2}', '${W9}', '${P9}', 25, '2026-10-27', 300, '${U.owner2}', now());
`;

/** @returns {null | object} null when MS_DB_URL is not set (tests should skip) */
function createTestDb() {
  const server = process.env.MS_DB_URL;
  if (!server) return null;
  const env = guard.checkEnv(process.env, guard.loadScope());
  if (!env.ok) throw new Error(`refusing to run database tests: ${env.reasons.join('; ')}`);

  const name = `ms_test_${process.pid}_${Date.now()}`;
  const url = (() => { const u = new URL(server); u.pathname = `/${name}`; return u.toString(); })();

  function as(user, sql) {
    const r = psql(url, `\\set VERBOSITY verbose\nbegin;\nset local role authenticated;\nset local request.jwt.claim.sub = '${user}';\n${sql}\ncommit;\n`);
    const m = /ERROR:\s+([0-9A-Z]{5}):/.exec(r.err);
    return { ...r, code: m ? m[1] : null };
  }

  const db = {
    url,
    setup() {
      must(server, `create database ${name};`);
      must(url, fs.readFileSync(path.join(SUPA, 'tests/local-auth-shim.sql'), 'utf8'));
      for (const f of fs.readdirSync(path.join(SUPA, 'migrations')).sort()) must(url, fs.readFileSync(path.join(SUPA, 'migrations', f), 'utf8'));
      must(url, FIXTURES);
    },
    teardown() { psql(server, `drop database if exists ${name} with (force);`); },
    admin: sql => must(url, sql),
    psql: input => psql(url, input),
    as,
    value(user, sql) {
      const r = as(user, sql);
      assert.ok(r.ok, r.err);
      return r.out;
    },
    code(user, sql) {
      const r = as(user, sql);
      assert.equal(r.ok, false, `expected an error, got: ${r.out}`);
      return r.code;
    },
    left(user, batch) { return Number(db.value(user, `select left_qty from public.stock_batches where id = '${batch}';`)); },
  };
  return db;
}

const lines = (prod, qty, extra = '') => `'[{"product_id":"${prod}","qty":${qty}${extra}}]'::jsonb`;

module.exports = { createTestDb, lines, id, U, C1, C2, W1, W2, W9, P1, P2, P9, B1, B2, B9 };

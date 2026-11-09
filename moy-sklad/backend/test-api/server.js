#!/usr/bin/env node
'use strict';
/**
 * Test stand API for «Мой склад». Reference contract for dev-backend and the
 * target for Playwright, ZAP and Locust. In-memory, fictional data only.
 * Refuses to start outside MS_ENV=local|test|ci and binds to 127.0.0.1 by default.
 */
const http = require('http');
const crypto = require('crypto');
const fixtures = require('./fixtures');

const ROLES_WRITE_STOCK = ['owner', 'staff'];
const ROLES_REQUEST = ['owner', 'staff', 'manager'];
const ROLES_FINANCE = ['owner', 'superadmin'];
const WASTE_REASONS = ['spoiled', 'wilted', 'defect', 'transport', 'other'];
const MAX_BODY = 16 * 1024;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;

function hash(password, salt) {
  return crypto.scryptSync(password, salt, 32);
}

function createState() {
  const users = fixtures.USERS.map(u => {
    const salt = crypto.randomBytes(16);
    return { ...u, salt, hash: hash(fixtures.TEST_PASSWORD, salt) };
  });
  return {
    users,
    batches: fixtures.BATCHES.map(b => ({ ...b, left: b.qty })),
    requests: [],
    waste: [],
    sessions: new Map(),
    fails: new Map(),
  };
}

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function send(res, status, body) {
  res.writeHead(status, SECURITY_HEADERS);
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('unsupported media type'), { status: 415 }));
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) tooLarge = true;
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('payload too large'), { status: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('invalid json'), { status: 400 })); }
    });
  });
}

const isPositiveInt = n => Number.isInteger(n) && n > 0 && n <= 100000;
const isText = (s, max = 80) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;

function createApp(state = createState()) {
  function auth(req) {
    const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
    const s = m && state.sessions.get(m[1]);
    if (!s || s.exp < Date.now()) return null;
    return { token: m[1], user: s.user };
  }

  function login(body, ip) {
    if (!isText(body.login, 64) || typeof body.password !== 'string' || body.password.length > 256) return [400, { error: 'login and password are required' }];
    const key = ip + '|' + body.login;
    const f = state.fails.get(key);
    if (f && f.count >= LOGIN_MAX_FAILS && Date.now() - f.first < LOGIN_WINDOW_MS) return [429, { error: 'too many attempts, try again later' }];
    const u = state.users.find(x => x.login === body.login);
    const ok = u && crypto.timingSafeEqual(hash(body.password, u.salt), u.hash);
    if (!ok) {
      const cur = f && Date.now() - f.first < LOGIN_WINDOW_MS ? f : { count: 0, first: Date.now() };
      state.fails.set(key, { ...cur, count: cur.count + 1 });
      return [401, { error: 'invalid login or password' }];
    }
    state.fails.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    state.sessions.set(token, { user: u, exp: Date.now() + TOKEN_TTL_MS });
    return [200, { token, role: u.role }];
  }

  const can = (u, roles) => roles.includes(u.role);
  const own = (u, item) => u.role === 'superadmin' || item.company === u.company;

  // Handlers receive { u, token, req, params } and return [status, body].
  async function receiveStock({ u, req }) {
    const b = await readJson(req);
    if (!isText(b.prod) || !isText(b.wh, 32) || !isPositiveInt(b.qty)) return [400, { error: 'prod, wh and a positive integer qty are required' }];
    const item = { id: 'b' + crypto.randomUUID(), company: u.company, wh: b.wh, prod: b.prod.trim(), qty: b.qty, left: b.qty, date: new Date().toISOString().slice(0, 10) };
    state.batches.push(item);
    return [201, { id: item.id }];
  }

  async function createRequest({ u, req }) {
    const b = await readJson(req);
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 50 || !b.lines.every(l => isText(l.prod) && isPositiveInt(l.qty))) {
      return [400, { error: 'lines must be 1-50 items with prod and a positive integer qty' }];
    }
    const item = { id: 'r' + crypto.randomUUID(), company: u.company, status: 'new', by: u.login, lines: b.lines.map(l => ({ prod: l.prod.trim(), qty: l.qty })) };
    state.requests.push(item);
    return [201, { id: item.id, status: item.status }];
  }

  function shipRequest({ u, params }) {
    const r = state.requests.find(x => x.id === params[0] && own(u, x));
    if (!r) return [404, { error: 'request not found' }];
    if (r.status !== 'new') return [409, { error: 'request is already closed' }];
    r.status = 'done';
    return [200, { id: r.id, status: r.status }];
  }

  async function writeOff({ u, req }) {
    const b = await readJson(req);
    const batch = state.batches.find(x => x.id === b.batch && own(u, x));
    if (!batch) return [404, { error: 'batch not found' }];
    if (!isPositiveInt(b.qty) || b.qty > batch.left || !WASTE_REASONS.includes(b.reason)) {
      return [400, { error: `qty must be 1..${batch.left} and reason one of ${WASTE_REASONS.join(', ')}` }];
    }
    batch.left -= b.qty;
    state.waste.push({ batch: batch.id, qty: b.qty, reason: b.reason, by: u.login, ts: Date.now() });
    return [201, { batch: batch.id, left: batch.left }];
  }

  const ANY = null;
  /** [method, path or regex, roles allowed (null = any signed-in user), handler] */
  const ROUTES = [
    ['POST', '/auth/logout', ANY, ({ token }) => { state.sessions.delete(token); return [204, {}]; }],
    ['GET', '/api/me', ANY, ({ u }) => [200, { login: u.login, role: u.role, company: u.company }]],
    ['GET', '/api/batches', ANY, ({ u }) => [200, { items: state.batches.filter(b => own(u, b) && b.left > 0).map(({ id, wh, prod, left, date }) => ({ id, wh, prod, left, date })) }]],
    ['POST', '/api/batches', ROLES_WRITE_STOCK, receiveStock],
    ['POST', '/api/requests', ROLES_REQUEST, createRequest],
    ['POST', /^\/api\/requests\/([\w-]{1,64})\/ship$/, ROLES_WRITE_STOCK, shipRequest],
    ['POST', '/api/waste', ROLES_WRITE_STOCK, writeOff],
    ['GET', '/api/finance', ROLES_FINANCE, ({ u }) => [200, { company: u.company, receivables: 0, payables: 0 }]],
    ['GET', '/api/admin/companies', ['superadmin'], () => [200, { items: fixtures.COMPANIES }]],
  ];

  function match(method, path) {
    for (const [m, p, roles, handler] of ROUTES) {
      if (m !== method) continue;
      if (typeof p === 'string' && p === path) return { roles, handler, params: [] };
      const r = typeof p !== 'string' && p.exec(path);
      if (r) return { roles, handler, params: r.slice(1) };
    }
    return null;
  }

  async function route(req, res) {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok' });
    if (req.method === 'POST' && path === '/auth/login') {
      const [status, body] = login(await readJson(req), req.socket.remoteAddress || '');
      return send(res, status, body);
    }
    const a = auth(req);
    if (!a) return send(res, 401, { error: 'sign in required' });
    const r = match(req.method, path);
    if (!r) return send(res, 404, { error: 'not found' });
    if (r.roles && !can(a.user, r.roles)) return send(res, 403, { error: 'not allowed for your role' });
    const [status, body] = await r.handler({ u: a.user, token: a.token, req, params: r.params });
    return send(res, status, body);
  }

  return http.createServer((req, res) => {
    route(req, res).catch(e => {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'internal error' });
    });
  });
}

if (require.main === module) {
  const env = (process.env.MS_ENV || '').toLowerCase();
  if (!['local', 'test', 'ci'].includes(env)) {
    process.stderr.write('[TestAPI] refusing to start: set MS_ENV to local, test or ci\n');
    process.exit(1);
  }
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(port, host, () => process.stdout.write(`[TestAPI] listening on http://${host}:${port} (MS_ENV=${env})\n`));
}

module.exports = { createApp, createState };

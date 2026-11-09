'use strict';
// Batch label printing logic of the mobile app. Runs with `node --experimental-strip-types` (unit stage).
const test = require('node:test');
const assert = require('node:assert/strict');
const label = require('../../app/src/domain/label.ts');
const scan = require('../../app/src/domain/scan.ts');

const BATCH = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';
const info = (over = {}) => ({
  code: scan.batchLabel(BATCH), product: 'Укроп', qty: '4 кор.', receivedOn: '2026-11-01',
  warehouse: 'Склад 1', supplier: 'Тепличное хозяйство', ...over,
});
// A tiny stand-in for a real QR matrix (the qrcode package lives in app/node_modules, absent in the unit job).
const matrix = () => ({ size: 3, data: Uint8Array.from([1, 0, 1, 0, 1, 0, 1, 1, 0]) });

test('copies are clamped to 1..50 and survive junk input', () => {
  assert.equal(label.clampCopies(0), 1);
  assert.equal(label.clampCopies(3.4), 3);
  assert.equal(label.clampCopies(500), label.MAX_COPIES);
  assert.equal(label.clampCopies(Number.NaN), 1);
});

test('the print button counts labels in correct Russian', () => {
  const cases = { 1: '1 этикетку', 2: '2 этикетки', 4: '4 этикетки', 5: '5 этикеток', 11: '11 этикеток', 12: '12 этикеток', 21: '21 этикетку', 22: '22 этикетки', 50: '50 этикеток' };
  for (const [n, text] of Object.entries(cases)) assert.equal(label.labelsCount(Number(n)), text);
});

test('QR SVG draws exactly the dark modules inside a quiet zone', () => {
  const svg = label.qrSvg(matrix());
  assert.equal((svg.match(/h1v1h-1z/g) || []).length, 5);
  assert.match(svg, /viewBox="0 0 7 7"/);
  // Module (x=1, y=2) is dark: drawn at (3, 4) after the 2-module quiet zone.
  assert.ok(svg.includes('M3 4h1v1h-1z'));
  assert.ok(!svg.includes('M4 4h1v1h-1z'));
});

test('label HTML repeats one label per copy and shows the batch facts', () => {
  const html = label.labelHtml(info(), matrix(), 3);
  assert.equal((html.match(/<section class="label">/g) || []).length, 3);
  assert.match(html, /@page\{size:58mm 40mm;margin:0\}/);
  for (const text of ['Укроп', '4 кор.', 'Приход 01.11.2026', 'Склад 1', 'Тепличное хозяйство', '3f2b8c1e']) {
    assert.ok(html.includes(text), `label shows ${text}`);
  }
});

test('names typed by users cannot inject markup into the printed page', () => {
  const html = label.labelHtml(info({ product: '<img src=x onerror=alert(1)>', supplier: '"Ромашка" & Co' }), matrix(), 1);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&quot;Ромашка&quot; &amp; Co'));
});

test('a label without a supplier omits that line', () => {
  const html = label.labelHtml(info({ supplier: null }), matrix(), 1);
  assert.equal((html.match(/class="meta"/g) || []).length, 2);
});

test('the printed code is what the scanner reads back as this batch', () => {
  const parsed = scan.parseScan(info().code);
  assert.equal(parsed.kind, 'batch');
  assert.equal(parsed.batchId, BATCH);
});

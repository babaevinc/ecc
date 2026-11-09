'use strict';
// Label scanning logic of the mobile app. Runs with `node --experimental-strip-types` (unit stage).
const test = require('node:test');
const assert = require('node:assert/strict');
const scan = require('../../app/src/domain/scan.ts');

const BATCH = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';

test('GS1 check digits for EAN-13, EAN-8 and UPC-A', () => {
  assert.equal(scan.hasValidCheckDigit('4601234567893'), true);
  assert.equal(scan.hasValidCheckDigit('4600000000008'), true);
  assert.equal(scan.hasValidCheckDigit('4601234567894'), false);
  assert.equal(scan.hasValidCheckDigit('96385074'), true);
  assert.equal(scan.hasValidCheckDigit('036000291452'), true);
  assert.equal(scan.hasValidCheckDigit('12345'), false);
});

test('scanner input is cleaned of Enter, Tab, GS and the configured prefix/suffix', () => {
  assert.equal(scan.cleanScan('4601234567893\r\n'), '4601234567893');
  assert.equal(scan.cleanScan('\u001d4601234567893\t'), '4601234567893');
  assert.equal(scan.cleanScan('#4601234567893$', { prefix: '#', suffix: '$' }), '4601234567893');
  assert.equal(scan.cleanScan('  ABC-123  '), 'ABC-123');
});

test('our batch labels are recognised, case-insensitive', () => {
  assert.deepEqual(scan.parseScan(scan.batchLabel(BATCH)), { kind: 'batch', batchId: BATCH });
  assert.deepEqual(scan.parseScan(`ms:b:${BATCH.toUpperCase()}\n`), { kind: 'batch', batchId: BATCH });
});

test('supplier barcodes: valid EAN accepted, misread digits rejected, other formats kept', () => {
  assert.deepEqual(scan.parseScan('4601234567893'), { kind: 'barcode', code: '4601234567893', format: 'ean13' });
  assert.deepEqual(scan.parseScan('96385074'), { kind: 'barcode', code: '96385074', format: 'ean8' });
  assert.equal(scan.parseScan('4601234567894').kind, 'invalid');
  assert.deepEqual(scan.parseScan('UKR-BOX-01'), { kind: 'barcode', code: 'UKR-BOX-01', format: 'other' });
  assert.equal(scan.parseScan('').kind, 'invalid');
  assert.equal(scan.parseScan('привет мир').kind, 'invalid');
});

test('keyboard-mode scanners are told apart from people typing', () => {
  assert.equal(scan.looksLikeScanner([0, 8, 15, 24, 31, 40]), true);
  assert.equal(scan.looksLikeScanner([0, 180, 400, 610]), false);
  assert.equal(scan.looksLikeScanner([0, 5]), false);
});

// Pure label-scanning logic: cleaning scanner input, barcode checksums, our batch labels.
// No imports: unit-tested in Node with --experimental-strip-types.

export type ScannerKind = 'camera' | 'keyboard' | 'terminal';

export type ScannerConfig = { prefix: string; suffix: string };

export type ScanResult =
  | { kind: 'batch'; batchId: string }
  | { kind: 'product'; productId: string }
  | { kind: 'barcode'; code: string; format: 'ean13' | 'ean8' | 'upc_a' | 'other' }
  | { kind: 'invalid'; reason: string };

export const SCANNER_KINDS: { value: ScannerKind; label: string; hint: string }[] = [
  { value: 'camera', label: 'Камера телефона', hint: 'Сканирует камерой прямо в приложении' },
  { value: 'keyboard', label: 'Bluetooth / USB', hint: 'Сканер в режиме клавиатуры: печатает код и нажимает Enter' },
  { value: 'terminal', label: 'Терминал', hint: 'Встроенный сканер складского терминала (режим «клавиатура»)' },
];

const BATCH_LABEL = /^MS:B:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
// Product stickers: the id is looked up afterwards, so any id-shaped text is accepted here.
const PRODUCT_LABEL = /^MS:P:([0-9A-Za-z_-]{1,64})$/;
const PRINTABLE = /^[0-9A-Za-z./:+-]{4,64}$/;

/** Text printed on our own batch labels as a QR code. */
export function batchLabel(batchId: string): string {
  return `MS:B:${batchId.toLowerCase()}`;
}

/** Text printed on our own product stickers as a QR code. */
export function productLabel(productId: string): string {
  return `MS:P:${productId}`;
}

/** Removes control characters (Enter, Tab, GS separators) and the scanner's configured prefix/suffix. */
export function cleanScan(raw: string, config: ScannerConfig = { prefix: '', suffix: '' }): string {
  let text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (config.prefix && text.startsWith(config.prefix)) text = text.slice(config.prefix.length);
  if (config.suffix && text.endsWith(config.suffix)) text = text.slice(0, -config.suffix.length);
  return text.trim();
}

/** GS1 check digit for EAN-8, UPC-A (12) and EAN-13. */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop() as number;
  // weights 3,1,3,1… from the rightmost data digit
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export function parseScan(raw: string, config?: ScannerConfig): ScanResult {
  const code = cleanScan(raw, config);
  if (!code) return { kind: 'invalid', reason: 'Пустой код — отсканируйте ещё раз' };
  const batch = BATCH_LABEL.exec(code);
  if (batch) return { kind: 'batch', batchId: batch[1].toLowerCase() };
  const product = PRODUCT_LABEL.exec(code);
  if (product) return { kind: 'product', productId: product[1] };
  if (/^\d+$/.test(code) && [8, 12, 13].includes(code.length)) {
    if (!hasValidCheckDigit(code)) return { kind: 'invalid', reason: 'Код считан с ошибкой — отсканируйте ещё раз' };
    return { kind: 'barcode', code, format: code.length === 13 ? 'ean13' : code.length === 8 ? 'ean8' : 'upc_a' };
  }
  if (!PRINTABLE.test(code)) return { kind: 'invalid', reason: 'Неизвестный формат кода' };
  return { kind: 'barcode', code, format: 'other' };
}

/** Scanners in keyboard mode type a whole code within milliseconds; people type far slower. */
export function looksLikeScanner(keyTimes: number[], maxAverageGapMs: number = 35): boolean {
  if (keyTimes.length < 4) return false;
  const gaps = keyTimes.slice(1).map((t, i) => t - keyTimes[i]);
  return gaps.reduce((a, g) => a + g, 0) / gaps.length <= maxAverageGapMs;
}

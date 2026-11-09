// Pure stock logic shared by screens and unit tests. No imports: Node can run it with --experimental-strip-types.

export type Unit = 'box' | 'kg';

export type Product = { id: string; name: string; unit: Unit; sortOrder: number | null; archived: boolean };

export type Warehouse = { id: string; name: string; kind: 'warehouse' | 'market_point'; archived: boolean };

export type StockBatch = {
  id: string;
  warehouseId: string;
  productId: string;
  receivedOn: string; // YYYY-MM-DD
  supplier: string | null;
  qty: number;
  leftQty: number;
};

export type ProductSummary = {
  productId: string;
  name: string;
  unit: Unit;
  total: number;
  oldestAgeDays: number | null;
  batches: number;
};

export const STALE_DAYS = 7;
export const WARN_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const UNIT_LABEL: Record<Unit, string> = { box: 'кор.', kg: 'кг' };

export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days between a receipt date and today (both local calendar dates). */
export function ageDays(receivedOn: string, today: string): number {
  const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((toUtc(today) - toUtc(receivedOn)) / DAY_MS);
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function formatQty(n: number, unit: Unit): string {
  return `${round3(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} ${UNIT_LABEL[unit]}`;
}

/**
 * Home list: products with stock, largest quantity first (owner's request); ties keep the owner's
 * importance order (sortOrder), then name.
 */
export function summarizeByProduct(
  batches: StockBatch[],
  products: Product[],
  today: string,
  warehouseIds?: ReadonlySet<string>,
): ProductSummary[] {
  const byId = new Map(products.map(p => [p.id, p]));
  const acc = new Map<string, ProductSummary>();
  for (const b of batches) {
    if (b.leftQty <= 0 || (warehouseIds && !warehouseIds.has(b.warehouseId))) continue;
    const p = byId.get(b.productId);
    if (!p) continue;
    const cur = acc.get(p.id) ?? { productId: p.id, name: p.name, unit: p.unit, total: 0, oldestAgeDays: null, batches: 0 };
    const age = ageDays(b.receivedOn, today);
    acc.set(p.id, {
      ...cur,
      total: round3(cur.total + b.leftQty),
      oldestAgeDays: cur.oldestAgeDays === null ? age : Math.max(cur.oldestAgeDays, age),
      batches: cur.batches + 1,
    });
  }
  const order = (id: string) => byId.get(id)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
  return [...acc.values()].sort((a, b) => b.total - a.total || order(a.productId) - order(b.productId) || a.name.localeCompare(b.name, 'ru'));
}

/** Batches still in stock that are at least `days` old, oldest first. */
export function staleBatches(batches: StockBatch[], today: string, days: number = STALE_DAYS): StockBatch[] {
  return batches
    .filter(b => b.leftQty > 0 && ageDays(b.receivedOn, today) >= days)
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));
}

export type QtyCheck = { ok: true; value: number } | { ok: false; error: string };

/** Boxes are whole numbers; kilograms allow up to 3 decimals. Accepts a comma as decimal separator. */
export function parseQty(input: string, unit: Unit, max: number = 100000): QtyCheck {
  const text = input.trim().replace(',', '.');
  if (!text) return { ok: false, error: 'Введите количество' };
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Количество должно быть больше нуля' };
  if (n > max) return { ok: false, error: `Не больше ${max.toLocaleString('ru-RU')}` };
  if (unit === 'box' && !Number.isInteger(n)) return { ok: false, error: 'Коробки — целое число' };
  if (unit === 'kg' && round3(n) !== n) return { ok: false, error: 'Вес — не больше 3 знаков после запятой' };
  return { ok: true, value: n };
}

/** −/+ buttons: step by 1, never below zero. */
export function stepQty(current: string, delta: number): string {
  const n = Number(current.replace(',', '.'));
  const next = round3((Number.isFinite(n) ? n : 0) + delta);
  return next > 0 ? String(next) : '';
}

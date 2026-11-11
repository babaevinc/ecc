// Shipping, sales and spoilage: pure rules shared by screens and unit tests.
// No imports: Node can run it with --experimental-strip-types.

export type Role = 'owner' | 'staff' | 'manager' | 'viewer';
export type RequestStatus = 'new' | 'in_progress' | 'done' | 'cancelled';
export type WasteReason = 'spoiled' | 'wilted' | 'defect' | 'transport' | 'other';

export const STATUS_LABEL: Record<RequestStatus, string> = { new: 'Новая', in_progress: 'В работе', done: 'Отгружена', cancelled: 'Отменена' };

export const WASTE_REASONS: { value: WasteReason; label: string }[] = [
  { value: 'spoiled', label: 'Сгнило' },
  { value: 'wilted', label: 'Завяло' },
  { value: 'defect', label: 'Брак' },
  { value: 'transport', label: 'Повреждено в дороге' },
  { value: 'other', label: 'Другое' },
];

/** What a role may do; the server checks the same rules again (and warehouse limits). */
export const can = {
  request: (r: Role | null): boolean => r === 'owner' || r === 'staff' || r === 'manager',
  ship: (r: Role | null): boolean => r === 'owner' || r === 'staff',
  sell: (r: Role | null): boolean => r === 'owner' || r === 'staff',
  writeOff: (r: Role | null): boolean => r === 'owner' || r === 'staff',
  cancelRequest: (r: Role | null, isAuthor: boolean): boolean => r === 'owner' || r === 'staff' || (r === 'manager' && isAuthor),
};

export type CartLine = { productId: string; qty: number; price: number | null };

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Adds a line; the same product at the same price is merged into one line. Returns a new array. */
export function addToCart(lines: readonly CartLine[], line: CartLine): CartLine[] {
  const i = lines.findIndex(l => l.productId === line.productId && l.price === line.price);
  if (i < 0) return [...lines, line];
  return lines.map((l, k) => (k === i ? { ...l, qty: round3(l.qty + line.qty) } : l));
}

export function removeFromCart(lines: readonly CartLine[], index: number): CartLine[] {
  return lines.filter((_, k) => k !== index);
}

/** Sum of priced lines, kopecks rounded. */
export function cartTotal(lines: readonly CartLine[]): number {
  return Math.round(lines.reduce((sum, l) => sum + (l.price ?? 0) * l.qty, 0) * 100) / 100;
}

/** The first product the cart asks more of than is available, or null when everything fits. */
export function overStock(lines: readonly CartLine[], available: (productId: string) => number): { productId: string; need: number; available: number } | null {
  const need = new Map<string, number>();
  for (const l of lines) need.set(l.productId, round3((need.get(l.productId) ?? 0) + l.qty));
  for (const [productId, qty] of need) {
    const have = available(productId);
    if (qty > have) return { productId, need: qty, available: have };
  }
  return null;
}

/** The price of the first priced line for a product; pass lines newest first to get the latest price. */
export function lastPrice(lines: readonly CartLine[], productId: string): number | null {
  return lines.find(l => l.productId === productId && l.price !== null)?.price ?? null;
}

export type PriceCheck = { ok: true; value: number | null } | { ok: false; error: string };

/** Price per box or kg: optional, a comma is accepted, at most 2 decimals. */
export function parsePrice(input: string): PriceCheck {
  const text = input.trim().replace(',', '.').replace(/\s/g, '');
  if (!text) return { ok: true, value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'Цена — число не меньше нуля' };
  if (n > 10_000_000) return { ok: false, error: 'Слишком большая цена' };
  if (Math.round(n * 100) / 100 !== n) return { ok: false, error: 'Цена — не больше 2 знаков после запятой' };
  return { ok: true, value: n };
}

export function formatMoney(n: number): string {
  return `${(Math.round(n * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

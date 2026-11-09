// First in, first out: sales and write-offs take the oldest batches first, as the server's take_fifo does.
// No imports: Node can run it with --experimental-strip-types.

type FifoBatch = { id: string; warehouseId: string; productId: string; receivedOn: string; leftQty: number };

export type FifoTake = { batchId: string; qty: number };
export type FifoPlan = { ok: true; takes: FifoTake[] } | { ok: false; available: number };

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Quantity of a product left in one warehouse. */
export function availableQty(batches: readonly FifoBatch[], warehouseId: string, productId: string): number {
  return round3(batches.reduce((sum, b) => (b.warehouseId === warehouseId && b.productId === productId && b.leftQty > 0 ? sum + b.leftQty : sum), 0));
}

/** Which batches to take `qty` from, oldest receipt first (ties keep the input order). */
export function planFifo(batches: readonly FifoBatch[], warehouseId: string, productId: string, qty: number): FifoPlan {
  const candidates = batches
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.warehouseId === warehouseId && b.productId === productId && b.leftQty > 0)
    .sort((x, y) => x.b.receivedOn.localeCompare(y.b.receivedOn) || x.index - y.index);
  const available = round3(candidates.reduce((sum, { b }) => sum + b.leftQty, 0));
  if (!(qty > 0) || qty > available) return { ok: false, available };
  const takes: FifoTake[] = [];
  let need = round3(qty);
  for (const { b } of candidates) {
    if (need <= 0) break;
    const take = round3(Math.min(need, b.leftQty));
    takes.push({ batchId: b.id, qty: take });
    need = round3(need - take);
  }
  return { ok: true, takes };
}

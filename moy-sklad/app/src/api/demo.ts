// In-memory demo with fictional data: web preview and screen tests. Enabled only with EXPO_PUBLIC_DEMO=1.
import { round3, todayIso, type Product, type StockBatch, type Warehouse } from '@/domain/stock';
import { planFifo } from '@/domain/fifo';
import type { CartLine, RequestStatus, WasteReason } from '@/domain/ops';
import { ApiError, type Api, type AppNotification, type DayOp, type Scanner, type Session, type StockRequest } from './types';

type DemoMovement = { id: string; group: string; batchId: string; qty: number; kind: 'sale' | 'waste' | 'ship'; price: number | null;
  markdown: boolean; reason: WasteReason | null; createdAt: string; voided: boolean };

/** Fictional demo labels: a supplier EAN-13 linked to «Укроп» and the QR of the oldest batch. */
export const DEMO_BARCODE = '4601234567893';
// Demo batch ids are UUIDs like real ones, so their printed labels scan back.
const demoBatchId = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const DEMO_BATCH_ID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayIso(d);
};

export const DEMO_LOGIN = 'demo@example.com';
export const DEMO_PASSWORD = 'demo-password';

export function createDemoApi(): Api {
  let session: Session | null = null;
  const listeners = new Set<(s: Session | null) => void>();
  const emit = () => listeners.forEach(l => l(session));

  const warehouses: Warehouse[] = [
    { id: 'w1', name: 'Склад 1', kind: 'warehouse', archived: false },
    { id: 'w2', name: 'Склад 2', kind: 'warehouse', archived: false },
    { id: 'w3', name: 'Точка на рынке', kind: 'market_point', archived: false },
  ];
  const products: Product[] = [
    { id: 'p1', name: 'Укроп', unit: 'box', sortOrder: 0, archived: false },
    { id: 'p2', name: 'Петрушка', unit: 'box', sortOrder: 1, archived: false },
    { id: 'p3', name: 'Кинза', unit: 'box', sortOrder: 2, archived: false },
    { id: 'p4', name: 'Базилик', unit: 'kg', sortOrder: 3, archived: false },
  ];
  const batches: StockBatch[] = [
    { id: DEMO_BATCH_ID, warehouseId: 'w1', productId: 'p1', receivedOn: daysAgo(9), supplier: 'Тепличное хозяйство', qty: 10, leftQty: 4 },
    { id: demoBatchId(2), warehouseId: 'w1', productId: 'p1', receivedOn: daysAgo(1), supplier: 'Тепличное хозяйство', qty: 12, leftQty: 12 },
    { id: demoBatchId(3), warehouseId: 'w1', productId: 'p3', receivedOn: daysAgo(2), supplier: null, qty: 40, leftQty: 35 },
    { id: demoBatchId(4), warehouseId: 'w2', productId: 'p2', receivedOn: daysAgo(5), supplier: null, qty: 8, leftQty: 8 },
    { id: demoBatchId(5), warehouseId: 'w3', productId: 'p4', receivedOn: daysAgo(0), supplier: null, qty: 2.5, leftQty: 2.5 },
  ];
  const notifications: AppNotification[] = [
    { id: 'n1', kind: 'request_new', payload: { number: 12 }, createdAt: new Date().toISOString(), readAt: null },
    { id: 'n2', kind: 'batch_stale', payload: { product_id: 'p1', warehouse_id: 'w1' }, createdAt: new Date().toISOString(), readAt: null },
  ];

  const ME = 'demo-user';
  const requests: StockRequest[] = [
    { id: 'r12', number: 12, warehouseId: 'w1', client: 'Кафе «Огород»', status: 'new', createdBy: 'demo-manager',
      createdAt: new Date().toISOString(), lines: [{ productId: 'p1', qty: 3, price: 320 }, { productId: 'p3', qty: 5, price: 280 }] },
  ];
  const movements: DemoMovement[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${++seq}`;

  /** Takes stock oldest batch first, or throws without changing anything. */
  function take(warehouseId: string, lines: CartLine[], kind: DemoMovement['kind'], extra: Pick<DemoMovement, 'markdown' | 'reason'>, group: string) {
    const plans = lines.map(l => ({ l, plan: planFifo(batches, warehouseId, l.productId, l.qty) }));
    const short = plans.find(p => !p.plan.ok);
    if (short) throw new ApiError(kind === 'waste' ? 'Нельзя списать больше, чем лежит на складе' : 'На складе не хватает товара');
    // Lines of one product are planned against the same stock, so check the total again.
    const left = new Map(batches.map(b => [b.id, b.leftQty]));
    for (const { l, plan } of plans) {
      if (!plan.ok) continue;
      const fresh = planFifo(batches.map(b => ({ ...b, leftQty: left.get(b.id) ?? 0 })), warehouseId, l.productId, l.qty);
      if (!fresh.ok) throw new ApiError('На складе не хватает товара');
      for (const t of fresh.takes) {
        left.set(t.batchId, round3((left.get(t.batchId) ?? 0) - t.qty));
        movements.push({ id: nextId('m'), group, batchId: t.batchId, qty: t.qty, kind, price: l.price, createdAt: new Date().toISOString(), voided: false, ...extra });
      }
    }
    for (const b of batches) b.leftQty = left.get(b.id) ?? b.leftQty;
  }
  const findRequest = (id: string) => {
    const r = requests.find(x => x.id === id);
    if (!r) throw new ApiError('Заявка не найдена');
    return r;
  };
  const setStatus = (id: string, status: RequestStatus) => {
    const i = requests.findIndex(x => x.id === id);
    requests[i] = { ...requests[i], status };
  };

  const barcodes = new Map<string, string>([[DEMO_BARCODE, 'p1']]);
  const scanners: Scanner[] = [];

  return {
    isDemo: true,
    async findBarcode(code) {
      return barcodes.get(code) ?? null;
    },
    async linkBarcode(code, productId) {
      if (barcodes.has(code)) throw new ApiError('Этот штрихкод уже привязан к другому товару');
      barcodes.set(code, productId);
    },
    async getBatch(batchId) {
      const b = batches.find(x => x.id === batchId && x.leftQty > 0);
      return b ? { ...b } : null;
    },
    async listScanners() {
      return scanners.map(s => ({ ...s }));
    },
    async addScanner(s) {
      if (scanners.some(x => x.name.toLowerCase() === s.name.trim().toLowerCase())) throw new ApiError('Сканер с таким названием уже есть');
      const id = `s${scanners.length + 1}`;
      scanners.push({ ...s, name: s.name.trim(), id, lastSeenAt: null });
      return id;
    },
    async removeScanner(id) {
      const i = scanners.findIndex(s => s.id === id);
      if (i >= 0) scanners.splice(i, 1);
    },
    async markScannerSeen(id) {
      const s = scanners.find(x => x.id === id);
      if (s) s.lastSeenAt = new Date().toISOString();
    },
    async signIn(login, password) {
      if (login.trim().toLowerCase() !== DEMO_LOGIN || password !== DEMO_PASSWORD) throw new ApiError('Неверный логин или пароль');
      session = { userId: 'demo-user', login: DEMO_LOGIN };
      emit();
    },
    async signOut() {
      session = null;
      emit();
    },
    async getSession() {
      return session;
    },
    onAuthChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async listWarehouses() {
      return warehouses.map(w => ({ ...w }));
    },
    async listProducts() {
      return products.map(p => ({ ...p }));
    },
    async listStock() {
      return batches.filter(b => b.leftQty > 0).map(b => ({ ...b }));
    },
    async receiveStock(input) {
      const id = demoBatchId(batches.length + 1);
      batches.push({ id, warehouseId: input.warehouseId, productId: input.productId, receivedOn: input.receivedOn,
        supplier: input.supplier || null, qty: round3(input.qty), leftQty: round3(input.qty) });
      return id;
    },
    async listNotifications() {
      return notifications.map(n => ({ ...n }));
    },
    async myAccess() {
      return session ? { role: 'owner', warehouseIds: [] } : null;
    },
    async listRequests() {
      return requests.map(r => ({ ...r, lines: r.lines.map(l => ({ ...l })) })).sort((a, b) => b.number - a.number);
    },
    async createRequest(request) {
      const number = Math.max(0, ...requests.map(r => r.number)) + 1;
      requests.push({ id: nextId('r'), number, warehouseId: request.warehouseId, client: request.client.trim() || null, status: 'new',
        createdBy: ME, createdAt: new Date().toISOString(), lines: request.lines.map(l => ({ ...l })) });
      return number;
    },
    async startRequest(id) {
      if (findRequest(id).status !== 'new') throw new ApiError('Операция уже выполнена или недоступна');
      setStatus(id, 'in_progress');
    },
    async shipRequest(id) {
      const r = findRequest(id);
      if (r.status !== 'new' && r.status !== 'in_progress') throw new ApiError('Заявка уже закрыта');
      take(r.warehouseId, r.lines, 'ship', { markdown: false, reason: null }, id);
      setStatus(id, 'done');
    },
    async cancelRequest(id) {
      const r = findRequest(id);
      if (r.status !== 'new' && r.status !== 'in_progress') throw new ApiError('Заявка уже закрыта');
      setStatus(id, 'cancelled');
    },
    async recordSale(sale) {
      take(sale.warehouseId, sale.lines, 'sale', { markdown: sale.markdown, reason: null }, nextId('g'));
    },
    async writeOff(input) {
      if (input.reason === 'other' && !input.note.trim()) throw new ApiError('Опишите причину в комментарии');
      take(input.warehouseId, [{ productId: input.productId, qty: input.qty, price: null }], 'waste', { markdown: false, reason: input.reason }, nextId('g'));
    },
    async listTodayOps() {
      const today = todayIso();
      const ops = new Map<string, DayOp>();
      for (const m of movements) {
        if (m.voided || m.kind === 'ship' || todayIso(new Date(m.createdAt)) !== today) continue;
        const b = batches.find(x => x.id === m.batchId);
        if (!b) continue;
        const op = ops.get(m.group) ?? { key: m.id, kind: m.kind, warehouseId: b.warehouseId, items: [], markdown: m.markdown, reason: m.reason, createdAt: m.createdAt, mine: true };
        const same = op.items.find(i => i.productId === b.productId && i.price === m.price);
        ops.set(m.group, { ...op, items: same ? op.items.map(i => (i === same ? { ...i, qty: round3(i.qty + m.qty) } : i)) : [...op.items, { productId: b.productId, qty: m.qty, price: m.price }] });
      }
      return [...ops.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async addProduct(product) {
      if (products.some(p => p.name.toLowerCase() === product.name.toLowerCase())) throw new ApiError('Такое название уже есть');
      const id = nextId('p-new-');
      products.push({ id, name: product.name, unit: product.unit, sortOrder: products.length, archived: false });
      return id;
    },
    async updateProduct(id, patch) {
      const i = products.findIndex(p => p.id === id);
      if (i < 0) throw new ApiError('Не найдено — возможно, запись удалили');
      const used = batches.some(b => b.productId === id);
      const inStock = batches.some(b => b.productId === id && b.leftQty > 0);
      if ((patch.unit && patch.unit !== products[i].unit && used) || (patch.archived && !products[i].archived && inStock)) {
        throw new ApiError('По этой зелени уже есть партии или остаток: единицу менять нельзя, а в архив — только после продажи или списания остатка');
      }
      if (patch.name && products.some(p => p.id !== id && p.name.toLowerCase() === patch.name!.toLowerCase())) throw new ApiError('Такое название уже есть');
      products[i] = { ...products[i], ...patch };
    },
    async deleteProduct(id) {
      if (batches.some(b => b.productId === id) || requests.some(r => r.lines.some(l => l.productId === id))) {
        throw new ApiError('По этой зелени есть операции — удалить нельзя, отправьте её в архив');
      }
      const i = products.findIndex(p => p.id === id);
      if (i >= 0) products.splice(i, 1);
      for (const [code, pid] of barcodes) if (pid === id) barcodes.delete(code);
    },
    async addWarehouse(warehouse) {
      if (warehouses.some(w => w.name.toLowerCase() === warehouse.name.toLowerCase())) throw new ApiError('Такое название уже есть');
      const id = nextId('w-new-');
      warehouses.push({ id, name: warehouse.name, kind: warehouse.kind, archived: false });
      return id;
    },
    async updateWarehouse(id, patch) {
      const i = warehouses.findIndex(w => w.id === id);
      if (i < 0) throw new ApiError('Не найдено — возможно, запись удалили');
      if (patch.archived && !warehouses[i].archived && batches.some(b => b.warehouseId === id && b.leftQty > 0)) {
        throw new ApiError('На складе ещё есть товар: сначала продайте, переместите или спишите остаток');
      }
      if (patch.name && warehouses.some(w => w.id !== id && w.name.toLowerCase() === patch.name!.toLowerCase())) throw new ApiError('Такое название уже есть');
      warehouses[i] = { ...warehouses[i], ...patch };
    },
    async deleteWarehouse(id) {
      if (batches.some(b => b.warehouseId === id) || requests.some(r => r.warehouseId === id)) {
        throw new ApiError('По этому складу есть операции — удалить нельзя, отправьте его в архив');
      }
      const i = warehouses.findIndex(w => w.id === id);
      if (i >= 0) warehouses.splice(i, 1);
    },
    async listBarcodes() {
      return [...barcodes].map(([code, productId]) => ({ code, productId })).sort((a, b) => a.code.localeCompare(b.code));
    },
    async unlinkBarcode(code) {
      barcodes.delete(code);
    },
    async cancelOp(key) {
      const first = movements.find(m => m.id === key);
      if (!first || first.voided) throw new ApiError('Операция уже отменена');
      for (const m of movements) {
        if (m.group !== first.group || m.voided) continue;
        m.voided = true;
        const b = batches.find(x => x.id === m.batchId);
        if (b) b.leftQty = round3(b.leftQty + m.qty);
      }
    },
  };
}

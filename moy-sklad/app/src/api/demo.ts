// In-memory demo with fictional data: web preview and screen tests. Enabled only with EXPO_PUBLIC_DEMO=1.
import { round3, todayIso, type Product, type StockBatch, type Warehouse } from '@/domain/stock';
import { ApiError, type Api, type AppNotification, type Scanner, type Session } from './types';

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
  };
}

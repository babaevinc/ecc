// In-memory demo with fictional data: web preview and screen tests. Enabled only with EXPO_PUBLIC_DEMO=1.
import { round3, todayIso, type Product, type StockBatch, type Warehouse } from '@/domain/stock';
import { ApiError, type Api, type AppNotification, type Session } from './types';

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
    { id: 'b1', warehouseId: 'w1', productId: 'p1', receivedOn: daysAgo(9), supplier: 'Тепличное хозяйство', qty: 10, leftQty: 4 },
    { id: 'b2', warehouseId: 'w1', productId: 'p1', receivedOn: daysAgo(1), supplier: 'Тепличное хозяйство', qty: 12, leftQty: 12 },
    { id: 'b3', warehouseId: 'w1', productId: 'p3', receivedOn: daysAgo(2), supplier: null, qty: 40, leftQty: 35 },
    { id: 'b4', warehouseId: 'w2', productId: 'p2', receivedOn: daysAgo(5), supplier: null, qty: 8, leftQty: 8 },
    { id: 'b5', warehouseId: 'w3', productId: 'p4', receivedOn: daysAgo(0), supplier: null, qty: 2.5, leftQty: 2.5 },
  ];
  const notifications: AppNotification[] = [
    { id: 'n1', kind: 'request_new', payload: { number: 12 }, createdAt: new Date().toISOString(), readAt: null },
    { id: 'n2', kind: 'batch_stale', payload: { product_id: 'p1', warehouse_id: 'w1' }, createdAt: new Date().toISOString(), readAt: null },
  ];

  return {
    isDemo: true,
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
      const id = `b${batches.length + 1}`;
      batches.push({ id, warehouseId: input.warehouseId, productId: input.productId, receivedOn: input.receivedOn,
        supplier: input.supplier || null, qty: round3(input.qty), leftQty: round3(input.qty) });
      return id;
    },
    async listNotifications() {
      return notifications.map(n => ({ ...n }));
    },
  };
}

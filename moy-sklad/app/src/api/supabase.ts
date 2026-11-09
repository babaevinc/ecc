import { createClient } from '@supabase/supabase-js';

import { messageForCode } from '@/domain/errors';
import type { Product, StockBatch, Unit, Warehouse } from '@/domain/stock';
import { secureStorage } from './secure-storage';
import type { ScannerKind } from '@/domain/scan';
import { ApiError, type Api, type AppNotification, type Scanner, type Session } from './types';

type DbError = { code?: string | null } | null;

function check(error: DbError): void {
  if (error) throw new ApiError(messageForCode(error.code));
}

const PHONE = /^\+?\d[\d\s()-]{6,}$/;

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb = createClient(url, anonKey, {
    auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });
  const toSession = (s: { user: { id: string; email?: string; phone?: string } } | null): Session | null =>
    s ? { userId: s.user.id, login: s.user.email || s.user.phone || '' } : null;

  /** The signed-in user's company (MVP: one company per user). */
  async function myCompanyId(): Promise<string> {
    const { data: auth } = await sb.auth.getSession();
    const { data, error } = await sb.from('members').select('company_id').eq('user_id', auth.session?.user.id ?? '').limit(1);
    check(error);
    if (!data?.length) throw new ApiError('Вы не состоите в компании. Обратитесь к владельцу');
    return data[0].company_id;
  }

  const toScanner = (s: { id: string; name: string; kind: string; prefix: string; suffix: string; warehouse_id: string | null; last_seen_at: string | null }): Scanner => ({
    id: s.id, name: s.name, kind: s.kind as ScannerKind, prefix: s.prefix, suffix: s.suffix, warehouseId: s.warehouse_id, lastSeenAt: s.last_seen_at,
  });

  return {
    isDemo: false,

    async signIn(login, password) {
      const credentials = PHONE.test(login.trim())
        ? { phone: login.replace(/[\s()-]/g, ''), password }
        : { email: login.trim().toLowerCase(), password };
      const { error } = await sb.auth.signInWithPassword(credentials);
      check(error);
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async getSession() {
      const { data } = await sb.auth.getSession();
      return toSession(data.session);
    },

    onAuthChange(listener) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => listener(toSession(session)));
      return () => data.subscription.unsubscribe();
    },

    async listWarehouses() {
      const { data, error } = await sb.from('warehouses').select('id, name, kind, archived').order('name');
      check(error);
      return (data ?? []).map((w): Warehouse => ({ id: w.id, name: w.name, kind: w.kind, archived: w.archived }));
    },

    async listProducts() {
      const { data, error } = await sb.from('products').select('id, name, unit, sort_order, archived')
        .order('sort_order', { ascending: true, nullsFirst: false }).order('name');
      check(error);
      return (data ?? []).map((p): Product => ({ id: p.id, name: p.name, unit: p.unit as Unit, sortOrder: p.sort_order, archived: p.archived }));
    },

    async listStock() {
      const { data, error } = await sb.from('stock_batches')
        .select('id, warehouse_id, product_id, received_on, supplier, qty, left_qty').gt('left_qty', 0);
      check(error);
      return (data ?? []).map((b): StockBatch => ({
        id: b.id, warehouseId: b.warehouse_id, productId: b.product_id, receivedOn: b.received_on,
        supplier: b.supplier, qty: Number(b.qty), leftQty: Number(b.left_qty),
      }));
    },

    async receiveStock(input) {
      const { data, error } = await sb.rpc('receive_stock', {
        p_warehouse: input.warehouseId, p_product: input.productId, p_qty: input.qty,
        p_received_on: input.receivedOn, p_supplier: input.supplier || null,
      });
      check(error);
      return String(data);
    },

    async listNotifications() {
      const { data, error } = await sb.from('notifications').select('id, kind, payload, created_at, read_at')
        .order('created_at', { ascending: false }).limit(50);
      check(error);
      return (data ?? []).map((n): AppNotification => ({ id: n.id, kind: n.kind, payload: n.payload ?? {}, createdAt: n.created_at, readAt: n.read_at }));
    },

    async findBarcode(code) {
      const { data, error } = await sb.from('product_barcodes').select('product_id').eq('code', code).limit(1);
      check(error);
      return data?.[0]?.product_id ?? null;
    },

    async linkBarcode(code, productId) {
      const { data: product, error: readError } = await sb.from('products').select('company_id').eq('id', productId).single();
      check(readError);
      if (!product) throw new ApiError('Товар не найден');
      const { error } = await sb.from('product_barcodes').insert({ company_id: product.company_id, code, product_id: productId });
      if (error?.code === '23505') throw new ApiError('Этот штрихкод уже привязан к другому товару');
      check(error);
    },

    async getBatch(batchId) {
      const { data, error } = await sb.from('stock_batches')
        .select('id, warehouse_id, product_id, received_on, supplier, qty, left_qty').eq('id', batchId).limit(1);
      check(error);
      const b = data?.[0];
      return b ? { id: b.id, warehouseId: b.warehouse_id, productId: b.product_id, receivedOn: b.received_on, supplier: b.supplier, qty: Number(b.qty), leftQty: Number(b.left_qty) } : null;
    },

    async listScanners() {
      const { data, error } = await sb.from('scanners').select('id, name, kind, prefix, suffix, warehouse_id, last_seen_at').order('name');
      check(error);
      return (data ?? []).map(toScanner);
    },

    async addScanner(s) {
      const company = await myCompanyId();
      const { data, error } = await sb.from('scanners')
        .insert({ company_id: company, name: s.name.trim(), kind: s.kind, prefix: s.prefix, suffix: s.suffix, warehouse_id: s.warehouseId })
        .select('id').single();
      if (error?.code === '23505') throw new ApiError('Сканер с таким названием уже есть');
      if (error?.code === '42501') throw new ApiError('Добавлять сканеры может только владелец компании');
      check(error);
      if (!data) throw new ApiError('Сканер не сохранился, попробуйте ещё раз');
      return data.id;
    },

    async removeScanner(id) {
      const { error } = await sb.from('scanners').delete().eq('id', id);
      check(error);
    },

    async markScannerSeen(id) {
      const { error } = await sb.rpc('mark_scanner_seen', { p_scanner: id });
      check(error);
    },
  };
}

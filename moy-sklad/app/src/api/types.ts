import type { CartLine, RequestStatus, Role, WasteReason } from '@/domain/ops';
import type { ScannerKind } from '@/domain/scan';
import type { Product, StockBatch, Warehouse } from '@/domain/stock';

export type Scanner = {
  id: string;
  name: string;
  kind: ScannerKind;
  prefix: string;
  suffix: string;
  warehouseId: string | null;
  lastSeenAt: string | null;
};

export type NewScanner = Omit<Scanner, 'id' | 'lastSeenAt'>;

export type Session = { userId: string; login: string };

export type AppNotification = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
};

export type ReceiveInput = {
  warehouseId: string;
  productId: string;
  qty: number;
  receivedOn: string;
  supplier: string;
};

export type Access = { role: Role; warehouseIds: string[] };

export type StockRequest = {
  id: string;
  number: number;
  warehouseId: string;
  client: string | null;
  status: RequestStatus;
  createdBy: string;
  createdAt: string;
  lines: CartLine[];
};

export type NewRequest = { warehouseId: string; client: string; lines: CartLine[] };
export type NewSale = { warehouseId: string; lines: CartLine[]; markdown: boolean; note: string };
export type WriteOffInput = { warehouseId: string; productId: string; qty: number; reason: WasteReason; note: string };

/** Today's sale or write-off as one entry (all its rows); `key` cancels it. */
export type DayOp = {
  key: string;
  kind: 'sale' | 'waste';
  warehouseId: string;
  items: CartLine[];
  markdown: boolean;
  reason: WasteReason | null;
  createdAt: string;
  mine: boolean;
};

/** Everything the screens need. Implemented by Supabase (production) and an in-memory demo. */
export interface Api {
  readonly isDemo: boolean;
  signIn(login: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
  onAuthChange(listener: (session: Session | null) => void): () => void;
  listWarehouses(): Promise<Warehouse[]>;
  listProducts(): Promise<Product[]>;
  listStock(): Promise<StockBatch[]>;
  receiveStock(input: ReceiveInput): Promise<string>;
  listNotifications(): Promise<AppNotification[]>;
  /** Product id a supplier barcode is linked to, or null when it is not linked yet. */
  findBarcode(code: string): Promise<string | null>;
  linkBarcode(code: string, productId: string): Promise<void>;
  /** A batch by the id printed on our own label, or null when it is unknown or empty. */
  getBatch(batchId: string): Promise<StockBatch | null>;
  listScanners(): Promise<Scanner[]>;
  addScanner(scanner: NewScanner): Promise<string>;
  removeScanner(id: string): Promise<void>;
  markScannerSeen(id: string): Promise<void>;
  /** The signed-in person's role and warehouse limits (empty list = all warehouses). */
  myAccess(): Promise<Access | null>;
  /** The latest requests, newest first. */
  listRequests(): Promise<StockRequest[]>;
  /** Creates a request and returns its number. */
  createRequest(request: NewRequest): Promise<number>;
  startRequest(id: string): Promise<void>;
  /** Ships a request: stock leaves the oldest batches first. */
  shipRequest(id: string): Promise<void>;
  cancelRequest(id: string): Promise<void>;
  /** Sale without a request, oldest batches first. */
  recordSale(sale: NewSale): Promise<void>;
  /** Spoilage of one product, oldest batches first. */
  writeOff(input: WriteOffInput): Promise<void>;
  /** Today's sales and write-offs that are not cancelled. */
  listTodayOps(): Promise<DayOp[]>;
  /** Cancels a sale or write-off; the stock comes back. */
  cancelOp(key: string): Promise<void>;
}

/** An error whose message is already safe and understandable to show to the user. */
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

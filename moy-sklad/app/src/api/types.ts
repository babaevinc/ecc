import type { Product, StockBatch, Warehouse } from '@/domain/stock';

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
}

/** An error whose message is already safe and understandable to show to the user. */
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

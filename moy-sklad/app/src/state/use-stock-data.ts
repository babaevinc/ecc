import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { ApiError } from '@/api/types';
import { NETWORK_MESSAGE } from '@/domain/errors';
import type { Product, StockBatch, Warehouse } from '@/domain/stock';
import { useApi } from './session';

export type StockData = { warehouses: Warehouse[]; products: Product[]; batches: StockBatch[] };

export function userMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : NETWORK_MESSAGE;
}

/** Loads warehouses, products and stock; reloads whenever the screen comes into focus. */
export function useStockData() {
  const api = useApi();
  const [data, setData] = useState<StockData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [warehouses, products, batches] = await Promise.all([api.listWarehouses(), api.listProducts(), api.listStock()]);
      setData({ warehouses: warehouses.filter(w => !w.archived), products: products.filter(p => !p.archived), batches });
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return { data, error, loading, reload };
}

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { Access } from '@/api/types';
import type { Warehouse } from '@/domain/stock';
import { useApi } from './session';

/** The signed-in person's role and warehouse limits; reloaded when the screen comes into focus. */
export function useAccess() {
  const api = useApi();
  const [access, setAccess] = useState<Access | null>(null);
  const [loaded, setLoaded] = useState(false);
  useFocusEffect(useCallback(() => {
    let alive = true;
    api.myAccess().then(a => { if (alive) { setAccess(a); setLoaded(true); } }, () => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [api]));
  return { access, role: access?.role ?? null, loaded };
}

/** Warehouses this person may work in: an empty limit list means all of them. */
export function allowedWarehouses(warehouses: Warehouse[], access: Access | null): Warehouse[] {
  if (!access || access.role === 'owner' || !access.warehouseIds.length) return warehouses;
  return warehouses.filter(w => access.warehouseIds.includes(w.id));
}

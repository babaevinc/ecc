// The warehouse a person worked in last, shared by «Приход» and «Отгрузка» and kept between launches,
// so it is chosen once rather than on every screen. Only an id is stored; it is not sensitive.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const KEY = 'ms.warehouse';
let current: string | null = null;
let loaded = false;
const listeners = new Set<(id: string | null) => void>();

function publish(id: string | null) {
  current = id;
  listeners.forEach(l => l(id));
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved && current === null) publish(saved);
  } catch {
    // Storage can be unavailable (private window): the choice then lives until the app closes.
  }
}

/** [last chosen warehouse id or null, choose a warehouse]. Callers must check the id still exists. */
export function usePreferredWarehouse(): [string | null, (id: string) => void] {
  const [id, setId] = useState(current);
  useEffect(() => {
    listeners.add(setId);
    setId(current);
    load();
    return () => { listeners.delete(setId); };
  }, []);
  const choose = useCallback((next: string) => {
    publish(next);
    AsyncStorage.setItem(KEY, next).catch(() => undefined);
  }, []);
  return [id, choose];
}

// Session storage for supabase-js: Keychain/Keystore via expo-secure-store, split into chunks because
// SecureStore values should stay small. On web (preview only) it falls back to localStorage.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CHUNK = 1800;
const safeKey = (key: string): string => key.replace(/[^A-Za-z0-9._-]/g, '_');

const web = {
  getItem: async (key: string): Promise<string | null> => globalThis.localStorage?.getItem(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => globalThis.localStorage?.setItem(key, value),
  removeItem: async (key: string): Promise<void> => globalThis.localStorage?.removeItem(key),
};

const native = {
  async getItem(key: string): Promise<string | null> {
    const k = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${k}.n`));
    if (!count) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${k}.${i}`);
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const k = safeKey(key);
    await native.removeItem(key);
    const count = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < count; i++) await SecureStore.setItemAsync(`${k}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${k}.n`, String(count));
  },
  async removeItem(key: string): Promise<void> {
    const k = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${k}.n`)) || 0;
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${k}.${i}`);
    await SecureStore.deleteItemAsync(`${k}.n`);
  },
};

export const secureStorage = Platform.OS === 'web' ? web : native;

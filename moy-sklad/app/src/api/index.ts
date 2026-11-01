import { createDemoApi } from './demo';
import { createSupabaseApi } from './supabase';
import type { Api } from './types';

export type ApiSetup = { api: Api; problem: null } | { api: null; problem: string };

/** EXPO_PUBLIC_* values are inlined at build time and are public: only the URL and the anon key belong here. */
export function createApi(): ApiSetup {
  if (process.env.EXPO_PUBLIC_DEMO === '1') return { api: createDemoApi(), problem: null };
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { api: null, problem: 'Приложение не настроено: задайте EXPO_PUBLIC_SUPABASE_URL и EXPO_PUBLIC_SUPABASE_ANON_KEY при сборке.' };
  }
  return { api: createSupabaseApi(url, key), problem: null };
}

export type { Api } from './types';

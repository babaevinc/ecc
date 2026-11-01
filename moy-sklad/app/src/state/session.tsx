import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createApi, type Api } from '@/api';
import type { Session } from '@/api/types';

type SessionState = { api: Api | null; problem: string | null; session: Session | null; ready: boolean };

const setup = createApi();
const SessionContext = createContext<SessionState>({ api: setup.api, problem: setup.problem, session: null, ready: false });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(setup.api === null);

  useEffect(() => {
    const api = setup.api;
    if (!api) return;
    let alive = true;
    api.getSession().then(s => {
      if (!alive) return;
      setSession(s);
      setReady(true);
    }, () => alive && setReady(true));
    const unsubscribe = api.onAuthChange(s => alive && setSession(s));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ api: setup.api, problem: setup.problem, session, ready }), [session, ready]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

export function useApi(): Api {
  const { api } = useContext(SessionContext);
  if (!api) throw new Error('API is not configured');
  return api;
}

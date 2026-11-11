// A short message that floats above the bottom edge, so the result of an action is visible
// wherever the screen is scrolled. One at a time; it hides by itself.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space, type, usePalette } from '@/theme';

type Tone = 'success' | 'error';
type Toast = { tone: Tone; text: string; id: number };
type Show = (tone: Tone, text: string) => void;

const HIDE_AFTER_MS = 4000;
// The native tab bar sits below the content; the web preview has its tabs at the top.
const ABOVE_TAB_BAR = Platform.OS === 'web' ? 24 : 96;

const ToastContext = createContext<Show>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<Show>((tone, text) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ tone, text, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), HIDE_AFTER_MS);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="none" style={[styles.wrap, { bottom: ABOVE_TAB_BAR + insets.bottom }]}>
          <View key={toast.id} accessibilityRole="alert" accessibilityLiveRegion="polite"
            style={[styles.toast, { backgroundColor: toast.tone === 'error' ? c.danger : c.accent }]}>
            <Text style={[type.body, styles.text, { color: c.onAccent }]}>{toast.text}</Text>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

/** `toast('success', 'Продажа записана')` — shown over any screen. */
export function useToast(): Show {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.l },
  toast: { maxWidth: 480, borderRadius: 14, paddingVertical: space.m, paddingHorizontal: space.l },
  text: { fontWeight: '600', textAlign: 'center' },
});

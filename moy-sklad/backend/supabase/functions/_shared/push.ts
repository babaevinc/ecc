// Pure push logic shared by the notify Edge Function (Deno) and unit tests (Node).
// No imports, only erasable TypeScript, so both runtimes can load it as is.

export type Details = {
  number?: number;
  warehouse?: string;
  client?: string;
  product?: string;
  unit?: 'box' | 'kg';
  received_on?: string;
  left_qty?: number;
};

export type PushRow = {
  notification_id: string;
  token: string;
  kind: string;
  payload: Record<string, unknown>;
  details: Details;
};

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
};

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const MAX_PER_REQUEST = 100;

const UNIT = { box: 'кор.', kg: 'кг' } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(isoDate: string, now: Date): number {
  const then = Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((today - then) / DAY_MS);
}

function qty(n: number): string {
  return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

/** Lock-screen text. Never contains prices or debts (ADR 0003). Unknown kinds return null. */
export function textFor(kind: string, d: Details, now: Date = new Date()): { title: string; body: string } | null {
  const where = [d.warehouse, d.client].filter(Boolean).join(' · ') || 'Откройте приложение';
  switch (kind) {
    case 'request_new':
      return { title: `Новая заявка №${d.number ?? '?'}`, body: where };
    case 'request_done':
      return { title: `Заявка №${d.number ?? '?'} отгружена`, body: where };
    case 'request_cancelled':
      return { title: `Заявка №${d.number ?? '?'} отменена`, body: where };
    case 'batch_stale': {
      const days = d.received_on ? daysSince(d.received_on, now) : null;
      const left = d.left_qty != null ? `осталось ${qty(d.left_qty)} ${UNIT[d.unit ?? 'box']}` : null;
      return {
        title: days != null ? `Партия лежит ${days} дн.` : 'Старая партия на складе',
        body: [d.product, d.warehouse, left].filter(Boolean).join(' · ') || 'Откройте приложение',
      };
    }
    default:
      return null;
  }
}

export function isExpoToken(token: string): boolean {
  return /^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(token);
}

export function buildMessages(rows: PushRow[], now: Date = new Date()): { messages: ExpoMessage[]; skipped: number } {
  const messages: ExpoMessage[] = [];
  let skipped = 0;
  for (const r of rows) {
    const text = textFor(r.kind, r.details ?? {}, now);
    if (!text || !isExpoToken(r.token)) {
      skipped++;
      continue;
    }
    const data: Record<string, unknown> = { kind: r.kind, notification_id: r.notification_id };
    for (const key of ['request_id', 'batch_id']) if (r.payload && r.payload[key]) data[key] = r.payload[key];
    messages.push({ to: r.token, ...text, data, sound: 'default', priority: 'high' });
  }
  return { messages, skipped };
}

export function chunk<T>(items: T[], size: number = MAX_PER_REQUEST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Tickets come back in the same order as the messages sent. */
export function deadTokens(messages: ExpoMessage[], tickets: ExpoTicket[]): string[] {
  const dead: string[] = [];
  tickets.forEach((t, i) => {
    if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered' && messages[i]) dead.push(messages[i].to);
  });
  return [...new Set(dead)];
}

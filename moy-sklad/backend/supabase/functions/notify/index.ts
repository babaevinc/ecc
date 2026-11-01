// Edge Function «notify»: sends unsent notifications as push messages through Expo Push.
// Invoked every minute by pg_cron + pg_net with the service role key (see backend/README.md).
// Unsent rows are claimed atomically, so overlapping runs never send the same message twice.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildMessages, chunk, deadTokens, EXPO_PUSH_URL, type ExpoTicket, type PushRow } from '../_shared/push.ts';

function json(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'server is not configured' }, 500);
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase.rpc('claim_push_batch', { p_limit: 500 });
  if (error) {
    console.error('[notify] claim_push_batch failed:', error.message);
    return json({ error: 'could not read notifications' }, 500);
  }
  const rows = (data ?? []) as PushRow[];
  const { messages, skipped } = buildMessages(rows);

  let sent = 0;
  const dead = new Set<string>();
  for (const part of chunk(messages)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(part),
    });
    if (!res.ok) {
      console.error(`[notify] Expo push returned HTTP ${res.status}`);
      continue;
    }
    const body = (await res.json()) as { data?: ExpoTicket[] };
    sent += part.length;
    for (const token of deadTokens(part, body.data ?? [])) dead.add(token);
  }
  for (const token of dead) await supabase.rpc('forget_push_token', { p_token: token });

  return json({ claimed: rows.length, sent, skipped, forgotten: dead.size });
});

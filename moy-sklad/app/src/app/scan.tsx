import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import type { Scanner } from '@/api/types';
import { CameraScanner } from '@/components/camera-scanner';
import { RequireSession } from '@/components/require-session';
import { ScanField } from '@/components/scan-field';
import { Group, Message, PrimaryButton, Row, Screen, Segmented } from '@/components/ui';
import { parseScan } from '@/domain/scan';
import { ageDays, formatQty, todayIso, WARN_DAYS, type StockBatch } from '@/domain/stock';
import { useApi } from '@/state/session';
import { userMessage, useStockData } from '@/state/use-stock-data';

type Resolved =
  | { type: 'product'; code: string; productId: string }
  | { type: 'unknown'; code: string }
  | { type: 'batch'; batch: StockBatch }
  | { type: 'error'; text: string };

const NO_SETTINGS = '';

export default function ScanRoute() {
  return (
    <RequireSession>
      <Stack.Screen options={{ headerShown: true, title: 'Сканирование', headerBackTitle: 'Назад' }} />
      <ScanScreen />
    </RequireSession>
  );
}

function ScanScreen() {
  const api = useApi();
  const { data } = useStockData();
  const [mode, setMode] = useState<'camera' | 'scanner'>(Platform.OS === 'web' ? 'scanner' : 'camera');
  const [scanners, setScanners] = useState<Scanner[]>([]);
  const [scannerId, setScannerId] = useState(NO_SETTINGS);
  const [result, setResult] = useState<Resolved | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listScanners().then(list => setScanners(list.filter(s => s.kind !== 'camera')), () => setScanners([]));
  }, [api]);

  const products = data?.products ?? [];
  const productName = (id: string) => products.find(p => p.id === id)?.name ?? 'Товар';

  async function handleScan(raw: string) {
    if (busy || result) return; // one result at a time; «Сканировать ещё» unlocks
    const scanner = scanners.find(s => s.id === scannerId);
    const parsed = parseScan(raw, scanner);
    if (parsed.kind === 'invalid') {
      setResult({ type: 'error', text: parsed.reason });
      return;
    }
    setBusy(true);
    try {
      if (scanner) api.markScannerSeen(scanner.id).catch(() => undefined);
      if (parsed.kind === 'batch') {
        const batch = await api.getBatch(parsed.batchId);
        setResult(batch ? { type: 'batch', batch } : { type: 'error', text: 'Партия не найдена или уже закончилась' });
      } else {
        const productId = await api.findBarcode(parsed.code);
        setResult(productId ? { type: 'product', code: parsed.code, productId } : { type: 'unknown', code: parsed.code });
      }
    } catch (e) {
      setResult({ type: 'error', text: userMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleLink(code: string, productId: string) {
    setBusy(true);
    try {
      await api.linkBarcode(code, productId);
      setResult({ type: 'product', code, productId });
    } catch (e) {
      setResult({ type: 'error', text: userMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Segmented value={mode} onChange={v => setMode(v as 'camera' | 'scanner')}
        options={[{ value: 'camera', label: 'Камера' }, { value: 'scanner', label: 'Сканер' }]} />

      {mode === 'camera' ? <CameraScanner onScan={handleScan} paused={busy || result !== null} /> : (
        <>
          {scanners.length ? (
            <Segmented value={scannerId} onChange={setScannerId}
              options={[{ value: NO_SETTINGS, label: 'Без настроек' }, ...scanners.map(s => ({ value: s.id, label: s.name }))]} />
          ) : null}
          <ScanField onScan={handleScan} />
        </>
      )}

      {busy ? <Message tone="info" text="Ищем…" /> : null}
      {result?.type === 'error' ? <Message tone="error" text={result.text} /> : null}

      {result?.type === 'product' ? (
        <>
          <Group title="Найден товар">
            <Row title={productName(result.productId)} subtitle={`штрихкод ${result.code}`} last />
          </Group>
          <PrimaryButton title="Принять этот товар" onPress={() => router.push({ pathname: '/receive', params: { product: result.productId } })} />
        </>
      ) : null}

      {result?.type === 'unknown' ? (
        <>
          <Message tone="info" text={`Штрихкод ${result.code} ещё не привязан. Выберите товар — в следующий раз он определится сам.`} />
          <Group title="Привязать к товару">
            {products.map((p, i) => (
              <Row key={p.id} title={p.name} onPress={() => handleLink(result.code, p.id)} last={i === products.length - 1} />
            ))}
          </Group>
        </>
      ) : null}

      {result?.type === 'batch' ? <BatchCard batch={result.batch} data={data} /> : null}

      {result ? <PrimaryButton title="Сканировать ещё" onPress={() => setResult(null)} /> : null}
    </Screen>
  );
}

function BatchCard({ batch, data }: { batch: StockBatch; data: ReturnType<typeof useStockData>['data'] }) {
  const product = data?.products.find(p => p.id === batch.productId);
  const warehouse = data?.warehouses.find(w => w.id === batch.warehouseId)?.name ?? '';
  const age = ageDays(batch.receivedOn, todayIso());
  return (
    <Group title="Партия по этикетке">
      <Row title={product?.name ?? 'Товар'} value={product ? formatQty(batch.leftQty, product.unit) : String(batch.leftQty)}
        subtitle={`${warehouse} · приход ${batch.receivedOn.slice(8, 10)}.${batch.receivedOn.slice(5, 7)} · ${age} дн.`}
        tone={age >= WARN_DAYS ? 'warning' : 'normal'} />
      <Row title="Печатать этикетку ещё раз" last chevron onPress={() => router.push({ pathname: '/label', params: { batch: batch.id } })} />
    </Group>
  );
}

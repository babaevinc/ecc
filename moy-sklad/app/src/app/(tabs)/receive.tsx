import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { Field, Group, Message, PrimaryButton, Row, Screen, Segmented, Stepper } from '@/components/ui';
import { type as typography, usePalette } from '@/theme';
import { formatQty, parseQty, todayIso } from '@/domain/stock';
import { useApi } from '@/state/session';
import { userMessage, useStockData } from '@/state/use-stock-data';

export default function ReceiveScreen() {
  const api = useApi();
  const { data, error: loadError } = useStockData();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [supplier, setSupplier] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const c = usePalette();
  const params = useLocalSearchParams<{ product?: string }>();
  const warehouses = data?.warehouses ?? [];
  const products = data?.products ?? [];
  const wh = warehouseId ?? (warehouses.length === 1 ? warehouses[0].id : null);
  // A product picked by scanning arrives as ?product=<id>; only accept ids that exist.
  const scanned = typeof params.product === 'string' && products.some(p => p.id === params.product) ? params.product : null;
  const selectedId = productId ?? scanned;
  const product = products.find(p => p.id === selectedId) ?? null;
  const scanButton = (
    <Pressable accessibilityRole="button" accessibilityLabel="Сканировать этикетку" onPress={() => router.push('/scan')}>
      <Text style={[typography.bodyBold, { color: c.accent }]}>Скан</Text>
    </Pressable>
  );

  async function handleSubmit() {
    if (!wh || !product) {
      setResult({ tone: 'error', text: 'Выберите склад и зелень' });
      return;
    }
    const check = parseQty(qty, product.unit);
    if (!check.ok) {
      setResult({ tone: 'error', text: check.error });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await api.receiveStock({ warehouseId: wh, productId: product.id, qty: check.value, receivedOn: todayIso(), supplier: supplier.trim() });
      setResult({ tone: 'success', text: `Принято: ${product.name}, ${formatQty(check.value, product.unit)}` });
      setQty('');
    } catch (e) {
      setResult({ tone: 'error', text: userMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Приход" right={scanButton}>
      {loadError ? <Message tone="error" text={loadError} /> : null}
      {warehouses.length > 1 ? (
        <Segmented value={wh ?? ''} onChange={setWarehouseId} options={warehouses.map(w => ({ value: w.id, label: w.name }))} />
      ) : null}
      <Group title="Зелень">
        {products.map((p, i) => (
          <Row key={p.id} title={p.name} subtitle={p.unit === 'kg' ? 'в килограммах' : 'в коробках'} selected={p.id === selectedId}
            onPress={() => setProductId(p.id)} last={i === products.length - 1} />
        ))}
      </Group>
      <Group title="Количество">
        <Stepper value={qty} onChange={setQty} unit={product?.unit ?? 'box'} />
      </Group>
      <Field value={supplier} onChangeText={setSupplier} placeholder="Поставщик (необязательно)" accessibilityLabel="Поставщик" />
      <PrimaryButton title="Принять" onPress={handleSubmit} busy={busy} />
      {result ? <Message tone={result.tone} text={result.text} /> : null}
    </Screen>
  );
}

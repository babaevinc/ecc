import { useState } from 'react';

import { Field, Group, Message, PrimaryButton, Row, Screen, Segmented, Stepper } from '@/components/ui';
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

  const warehouses = data?.warehouses ?? [];
  const products = data?.products ?? [];
  const wh = warehouseId ?? (warehouses.length === 1 ? warehouses[0].id : null);
  const product = products.find(p => p.id === productId) ?? null;

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
    <Screen title="Приход">
      {loadError ? <Message tone="error" text={loadError} /> : null}
      {warehouses.length > 1 ? (
        <Segmented value={wh ?? ''} onChange={setWarehouseId} options={warehouses.map(w => ({ value: w.id, label: w.name }))} />
      ) : null}
      <Group title="Зелень">
        {products.map((p, i) => (
          <Row key={p.id} title={p.name} subtitle={p.unit === 'kg' ? 'в килограммах' : 'в коробках'} selected={p.id === productId}
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

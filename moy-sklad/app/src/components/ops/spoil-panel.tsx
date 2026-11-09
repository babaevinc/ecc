// Spoilage: write off one product, oldest batches first, with a reason; today's write-offs can be cancelled.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { DayOp } from '@/api/types';
import { TodayOps } from '@/components/ops/today-ops';
import { Field, Group, Message, PrimaryButton, Row, Segmented, Stepper } from '@/components/ui';
import { WASTE_REASONS, type Role, type WasteReason } from '@/domain/ops';
import { formatQty, parseQty, type Warehouse } from '@/domain/stock';
import { useApi } from '@/state/session';
import { userMessage, type StockData } from '@/state/use-stock-data';

type Props = { data: StockData; warehouseId: string; warehouses: Warehouse[]; role: Role | null; available: (pid: string) => number; onChanged: () => void };

export function SpoilPanel({ data, warehouseId, warehouses, role, available, onChanged }: Props) {
  const api = useApi();
  const [productId, setProductId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<WasteReason>('spoiled');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<DayOp[]>([]);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const inStock = data.products.filter(p => available(p.id) > 0);
  const product = inStock.find(p => p.id === productId) ?? null;

  const reload = useCallback(async () => {
    try {
      setOps((await api.listTodayOps()).filter(o => o.kind === 'waste'));
    } catch (e) {
      setNotice({ tone: 'error', text: userMessage(e) });
    }
  }, [api]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  async function handleWriteOff() {
    if (!product) return setNotice({ tone: 'error', text: 'Выберите зелень' });
    const q = parseQty(qty, product.unit, available(product.id));
    if (!q.ok) return setNotice({ tone: 'error', text: q.error.startsWith('Не больше') ? `На складе только ${formatQty(available(product.id), product.unit)}` : q.error });
    if (reason === 'other' && !note.trim()) return setNotice({ tone: 'error', text: 'Опишите причину в комментарии' });
    setBusy(true);
    setNotice(null);
    try {
      await api.writeOff({ warehouseId, productId: product.id, qty: q.value, reason, note });
      setNotice({ tone: 'success', text: `Списано: ${product.name}, ${formatQty(q.value, product.unit)}` });
      setQty('');
      setNote('');
      setProductId(null);
      await reload();
      onChanged();
    } catch (e) {
      setNotice({ tone: 'error', text: userMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(op: DayOp) {
    try {
      await api.cancelOp(op.key);
      setNotice({ tone: 'success', text: 'Списание отменено, товар вернулся на остаток' });
      await reload();
      onChanged();
    } catch (e) {
      setNotice({ tone: 'error', text: userMessage(e) });
    }
  }

  return (
    <>
      <Group title="Что испортилось">
        {inStock.length ? inStock.map((p, i) => (
          <Row key={p.id} title={p.name} subtitle={`есть ${formatQty(available(p.id), p.unit)}`} selected={p.id === productId}
            onPress={() => setProductId(p.id)} last={i === inStock.length - 1} />
        )) : <Row title="На этом складе пусто" last />}
      </Group>
      <Group title="Сколько выбросить">
        <Stepper value={qty} onChange={setQty} unit={product?.unit ?? 'box'} />
      </Group>
      <Segmented value={reason} onChange={v => setReason(v as WasteReason)} options={WASTE_REASONS} />
      <Field value={note} onChangeText={setNote} accessibilityLabel="Комментарий" maxLength={500}
        placeholder={reason === 'other' ? 'Что случилось (обязательно)' : 'Комментарий (необязательно)'} />
      <Message tone="info" text="Списываются самые старые партии этой зелени." />
      <PrimaryButton title="Списать" onPress={handleWriteOff} busy={busy} />
      {notice ? <Message tone={notice.tone} text={notice.text} /> : null}
      <TodayOps title="Списано сегодня" ops={ops} products={data.products} warehouses={warehouses} empty="Сегодня ничего не списывали"
        canCancel={op => op.mine || role === 'owner'} onCancel={handleCancel} />
    </>
  );
}

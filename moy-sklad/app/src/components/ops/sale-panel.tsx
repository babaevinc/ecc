// Sale without a request: stock leaves the oldest batches first; today's sales can be cancelled.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { DayOp } from '@/api/types';
import { CartList } from '@/components/ops/cart-list';
import { LinePicker } from '@/components/ops/line-picker';
import { TodayOps } from '@/components/ops/today-ops';
import { Field, Message, PrimaryButton, SwitchRow } from '@/components/ui';
import { addToCart, cartTotal, formatMoney, overStock, removeFromCart, type CartLine, type Role } from '@/domain/ops';
import { formatQty, type Warehouse } from '@/domain/stock';
import { useApi } from '@/state/session';
import { userMessage, type StockData } from '@/state/use-stock-data';

type Props = { data: StockData; warehouseId: string; warehouses: Warehouse[]; role: Role | null; available: (pid: string) => number; onChanged: () => void };

export function SalePanel({ data, warehouseId, warehouses, role, available, onChanged }: Props) {
  const api = useApi();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [markdown, setMarkdown] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<DayOp[]>([]);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      setOps((await api.listTodayOps()).filter(o => o.kind === 'sale'));
    } catch (e) {
      setNotice({ tone: 'error', text: userMessage(e) });
    }
  }, [api]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  async function handleSell() {
    if (!lines.length) return setNotice({ tone: 'error', text: 'Добавьте хотя бы одну позицию' });
    const short = overStock(lines, available);
    if (short) {
      const p = data.products.find(x => x.id === short.productId);
      return setNotice({ tone: 'error', text: `${p?.name ?? 'Товар'}: доступно только ${p ? formatQty(short.available, p.unit) : short.available}` });
    }
    setBusy(true);
    setNotice(null);
    try {
      const total = cartTotal(lines);
      await api.recordSale({ warehouseId, lines, markdown, note });
      setLines([]);
      setMarkdown(false);
      setNote('');
      setNotice({ tone: 'success', text: total ? `Продажа записана: ${formatMoney(total)}` : 'Продажа записана' });
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
      setNotice({ tone: 'success', text: 'Продажа отменена, товар вернулся на остаток' });
      await reload();
      onChanged();
    } catch (e) {
      setNotice({ tone: 'error', text: userMessage(e) });
    }
  }

  return (
    <>
      <LinePicker products={data.products.filter(p => available(p.id) > 0)} available={available} withPrice addTitle="Добавить в продажу" onAdd={l => setLines(cur => addToCart(cur, l))} />
      <CartList title="В продаже" lines={lines} products={data.products} onRemove={i => setLines(cur => removeFromCart(cur, i))} />
      {lines.length ? (
        <>
          <SwitchRow title="Уценка: товар потерял вид" value={markdown} onChange={setMarkdown} />
          <Field value={note} onChangeText={setNote} placeholder="Комментарий (необязательно)" accessibilityLabel="Комментарий" maxLength={500} />
          <PrimaryButton title="Записать продажу" onPress={handleSell} busy={busy} />
        </>
      ) : null}
      {notice ? <Message tone={notice.tone} text={notice.text} /> : null}
      <TodayOps title="Продано сегодня" ops={ops} products={data.products} warehouses={warehouses} empty="Сегодня продаж ещё не было"
        canCancel={op => op.mine || role === 'owner'} onCancel={handleCancel} />
    </>
  );
}

// Sale without a request: stock leaves the oldest batches first; today's sales can be cancelled.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { DayOp } from '@/api/types';
import { CartList } from '@/components/ops/cart-list';
import { LinePicker } from '@/components/ops/line-picker';
import { TodayOps } from '@/components/ops/today-ops';
import { Field, PrimaryButton, SwitchRow } from '@/components/ui';
import { addToCart, cartTotal, formatMoney, lastPrice, overStock, removeFromCart, type CartLine, type Role } from '@/domain/ops';
import { formatQty, type Warehouse } from '@/domain/stock';
import { useToast } from '@/components/toast';
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
  const toast = useToast();

  const reload = useCallback(async () => {
    try {
      setOps((await api.listTodayOps()).filter(o => o.kind === 'sale'));
    } catch (e) {
      toast('error', userMessage(e));
    }
  }, [api, toast]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  async function handleSell() {
    if (!lines.length) return toast('error', 'Добавьте хотя бы одну позицию');
    const short = overStock(lines, available);
    if (short) {
      const p = data.products.find(x => x.id === short.productId);
      return toast('error', `${p?.name ?? 'Товар'}: доступно только ${p ? formatQty(short.available, p.unit) : short.available}`);
    }
    setBusy(true);
    try {
      const total = cartTotal(lines);
      await api.recordSale({ warehouseId, lines, markdown, note });
      setLines([]);
      setMarkdown(false);
      setNote('');
      toast('success', total ? `Продажа записана: ${formatMoney(total)}` : 'Продажа записана');
      await reload();
      onChanged();
    } catch (e) {
      toast('error', userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(op: DayOp) {
    try {
      await api.cancelOp(op.key);
      toast('success', 'Продажа отменена, товар вернулся на остаток');
      await reload();
      onChanged();
    } catch (e) {
      toast('error', userMessage(e));
    }
  }

  return (
    <>
      <LinePicker products={data.products.filter(p => available(p.id) > 0)} available={available} withPrice addTitle="Добавить в продажу"
        suggestPrice={pid => lastPrice([...lines].reverse().concat(ops.flatMap(o => o.items)), pid)} onAdd={l => setLines(cur => addToCart(cur, l))} />
      <CartList title="В продаже" lines={lines} products={data.products} onRemove={i => setLines(cur => removeFromCart(cur, i))} />
      {lines.length ? (
        <>
          <SwitchRow title="Уценка: товар потерял вид" value={markdown} onChange={setMarkdown} />
          <Field value={note} onChangeText={setNote} placeholder="Комментарий (необязательно)" accessibilityLabel="Комментарий" maxLength={500} />
          <PrimaryButton title="Записать продажу" onPress={handleSell} busy={busy} />
        </>
      ) : null}
      <TodayOps title="Продано сегодня" ops={ops} products={data.products} warehouses={warehouses} empty="Сегодня продаж ещё не было"
        canCancel={op => op.mine || role === 'owner'} onCancel={handleCancel} />
    </>
  );
}

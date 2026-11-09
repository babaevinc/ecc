// Requests: create one (owner, staff, manager), then start, ship or cancel it (owner, staff; a manager cancels own).
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { StockRequest } from '@/api/types';
import { CartList } from '@/components/ops/cart-list';
import { LinePicker } from '@/components/ops/line-picker';
import { Field, Group, Message, PrimaryButton, Row, SmallButton } from '@/components/ui';
import { addToCart, can, cartTotal, formatMoney, overStock, removeFromCart, STATUS_LABEL, type CartLine, type Role } from '@/domain/ops';
import { formatQty, type Warehouse } from '@/domain/stock';
import { useApi, useSession } from '@/state/session';
import { userMessage, type StockData } from '@/state/use-stock-data';
import { space } from '@/theme';

type Props = {
  data: StockData; warehouseId: string; warehouses: Warehouse[]; role: Role | null;
  available: (pid: string) => number; stockIn: (warehouseId: string, pid: string) => number; onChanged: () => void;
};

const when = (iso: string): string => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function RequestsPanel({ data, warehouseId, warehouses, role, available, stockIn, onChanged }: Props) {
  const api = useApi();
  const { session } = useSession();
  const [list, setList] = useState<StockRequest[]>([]);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [client, setClient] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      setList(await api.listRequests());
    } catch (e) {
      setNotice({ tone: 'error', text: userMessage(e) });
    }
  }, [api]);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const name = (pid: string) => data.products.find(p => p.id === pid);
  const visible = list.filter(r => warehouses.some(w => w.id === r.warehouseId));
  const open = visible.filter(r => r.status === 'new' || r.status === 'in_progress');
  const closed = visible.filter(r => r.status === 'done' || r.status === 'cancelled').slice(0, 10);

  async function run(key: string, action: () => Promise<string | void>, done: string) {
    setBusy(key);
    setNotice(null);
    try {
      const text = await action();
      setNotice({ tone: 'success', text: text || done });
      await reload();
      onChanged();
    } catch (e) {
      setNotice({ tone: 'error', text: userMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  function handleCreate() {
    if (!lines.length) return setNotice({ tone: 'error', text: 'Добавьте в заявку хотя бы одну позицию' });
    run('create', async () => {
      const number = await api.createRequest({ warehouseId, client, lines });
      setLines([]);
      setClient('');
      return `Заявка №${number} создана`;
    }, 'Заявка создана');
  }

  function handleShip(r: StockRequest) {
    const short = overStock(r.lines, pid => stockIn(r.warehouseId, pid));
    if (short) {
      const p = name(short.productId);
      return setNotice({ tone: 'error', text: `${p?.name ?? 'Товар'}: на складе ${p ? formatQty(short.available, p.unit) : short.available}, а в заявке ${p ? formatQty(short.need, p.unit) : short.need}` });
    }
    run(r.id, async () => { await api.shipRequest(r.id); }, `Заявка №${r.number} отгружена, товар списан со склада`);
  }

  function handleCancel(r: StockRequest) {
    if (confirm !== r.id) return setConfirm(r.id);
    setConfirm(null);
    run(r.id, async () => { await api.cancelRequest(r.id); }, `Заявка №${r.number} отменена`);
  }

  const card = (r: StockRequest) => {
    const active = r.status === 'new' || r.status === 'in_progress';
    const total = cartTotal(r.lines);
    const mayCancel = active && can.cancelRequest(role, r.createdBy === session?.userId);
    return (
      <Group key={r.id} title={`№${r.number} · ${STATUS_LABEL[r.status]}`}>
        <Row title={r.client || 'Без клиента'} subtitle={`${warehouses.find(w => w.id === r.warehouseId)?.name ?? ''} · ${when(r.createdAt)}`}
          value={total ? formatMoney(total) : undefined} />
        {r.lines.map((l, i) => {
          const p = name(l.productId);
          return <Row key={i} title={p?.name ?? 'Товар'} value={p ? formatQty(l.qty, p.unit) : String(l.qty)}
            subtitle={l.price === null ? undefined : `${formatMoney(l.price)} за ${p?.unit === 'kg' ? 'кг' : 'кор.'}`} last={!active && i === r.lines.length - 1} />;
        })}
        {active && (can.ship(role) || mayCancel) ? (
          <View style={styles.actions}>
            {can.ship(role) ? <SmallButton title="Отгрузить" tone="accent" busy={busy === r.id} onPress={() => handleShip(r)} label={`Отгрузить заявку №${r.number}`} /> : null}
            {can.ship(role) && r.status === 'new' ? <SmallButton title="В работу" busy={busy === r.id} onPress={() => run(r.id, async () => { await api.startRequest(r.id); }, `Заявка №${r.number} в работе`)} label={`Взять в работу заявку №${r.number}`} /> : null}
            {mayCancel ? <SmallButton title={confirm === r.id ? 'Точно отменить?' : 'Отменить'} tone={confirm === r.id ? 'danger' : 'plain'} busy={busy === r.id} onPress={() => handleCancel(r)} label={`Отменить заявку №${r.number}`} /> : null}
          </View>
        ) : null}
      </Group>
    );
  };

  return (
    <>
      {notice ? <Message tone={notice.tone} text={notice.text} /> : null}
      {open.length ? open.map(card) : <Group title="Открытые заявки"><Row title="Открытых заявок нет" last /></Group>}
      {can.request(role) ? (
        <>
          <View style={styles.gap} />
          <Group title="Новая заявка">
            <Field value={client} onChangeText={setClient} placeholder="Клиент (необязательно)" accessibilityLabel="Клиент" maxLength={120} style={{ marginBottom: 0 }} />
          </Group>
          <LinePicker products={data.products} available={available} withPrice addTitle="Добавить в заявку" onAdd={l => setLines(cur => addToCart(cur, l))} />
          <CartList title="В заявке" lines={lines} products={data.products} onRemove={i => setLines(cur => removeFromCart(cur, i))} />
          {lines.length ? <PrimaryButton title="Создать заявку" onPress={handleCreate} busy={busy === 'create'} /> : null}
        </>
      ) : null}
      {closed.length ? <><View style={styles.gap} />{closed.map(card)}</> : null}
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.m },
  gap: { height: space.xl },
});

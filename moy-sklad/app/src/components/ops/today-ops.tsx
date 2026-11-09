// Today's sales or write-offs; the author (or the owner) can cancel one, and the stock comes back.
import { useState } from 'react';

import type { DayOp } from '@/api/types';
import { Group, Row } from '@/components/ui';
import { cartTotal, formatMoney, WASTE_REASONS } from '@/domain/ops';
import { formatQty, type Product, type Warehouse } from '@/domain/stock';

type Props = {
  title: string;
  ops: DayOp[];
  products: Product[];
  warehouses: Warehouse[];
  canCancel: (op: DayOp) => boolean;
  onCancel: (op: DayOp) => void;
  empty: string;
};

const time = (iso: string): string => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function TodayOps({ title, ops, products, warehouses, canCancel, onCancel, empty }: Props) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const name = (id: string) => products.find(p => p.id === id);
  return (
    <Group title={title}>
      {ops.length ? ops.map((op, i) => {
        const what = op.items.map(it => { const p = name(it.productId); return `${p?.name ?? 'Товар'} ${p ? formatQty(it.qty, p.unit) : it.qty}`; }).join(', ');
        const extra = op.kind === 'waste' ? WASTE_REASONS.find(r => r.value === op.reason)?.label : op.markdown ? 'уценка' : '';
        const total = cartTotal(op.items);
        const cancellable = canCancel(op);
        return (
          <Row key={op.key} title={what} last={i === ops.length - 1}
            subtitle={[time(op.createdAt), warehouses.find(w => w.id === op.warehouseId)?.name, extra, total ? formatMoney(total) : ''].filter(Boolean).join(' · ')}
            value={cancellable ? (confirm === op.key ? 'Точно отменить?' : 'Отменить') : undefined}
            onPress={cancellable ? () => { if (confirm === op.key) { setConfirm(null); onCancel(op); } else setConfirm(op.key); } : undefined} />
        );
      }) : <Row title={empty} last />}
    </Group>
  );
}

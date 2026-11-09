// Lines already added to a request or sale; tap «Убрать» to drop one.
import { Group, Row } from '@/components/ui';
import { cartTotal, formatMoney, type CartLine } from '@/domain/ops';
import { formatQty, type Product } from '@/domain/stock';

type Props = { title: string; lines: CartLine[]; products: Product[]; onRemove: (index: number) => void };

export function CartList({ title, lines, products, onRemove }: Props) {
  if (!lines.length) return null;
  const total = cartTotal(lines);
  return (
    <Group title={title}>
      {lines.map((l, i) => {
        const p = products.find(x => x.id === l.productId);
        const qty = p ? formatQty(l.qty, p.unit) : String(l.qty);
        return (
          <Row key={`${l.productId}-${l.price}-${i}`} title={p?.name ?? 'Товар'} value="Убрать" onPress={() => onRemove(i)}
            subtitle={l.price === null ? qty : `${qty} × ${formatMoney(l.price)} = ${formatMoney(l.qty * l.price)}`} last={!total && i === lines.length - 1} />
        );
      })}
      {total ? <Row title="Сумма" value={formatMoney(total)} last /> : null}
    </Group>
  );
}

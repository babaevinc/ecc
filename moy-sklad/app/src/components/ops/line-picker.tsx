// Pick a product, a quantity and (optionally) a price, then add the line to a request or sale.
import { useState } from 'react';

import { Field, Group, Message, PrimaryButton, Row, Stepper } from '@/components/ui';
import { parsePrice, type CartLine } from '@/domain/ops';
import { formatQty, parseQty, type Product } from '@/domain/stock';

type Props = {
  products: Product[];
  available: (productId: string) => number;
  withPrice: boolean;
  addTitle: string;
  onAdd: (line: CartLine) => void;
};

export function LinePicker({ products, available, withPrice, addTitle, onAdd }: Props) {
  const [productId, setProductId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const product = products.find(p => p.id === productId) ?? null;

  function handleAdd() {
    if (!product) return setError('Выберите зелень');
    const q = parseQty(qty, product.unit);
    if (!q.ok) return setError(q.error);
    const p = withPrice ? parsePrice(price) : ({ ok: true, value: null } as const);
    if (!p.ok) return setError(p.error);
    setError(null);
    onAdd({ productId: product.id, qty: q.value, price: p.value });
    setQty('');
    setPrice('');
    setProductId(null);
  }

  return (
    <>
      <Group title="Зелень">
        {products.map((p, i) => {
          const left = available(p.id);
          return (
            <Row key={p.id} title={p.name} selected={p.id === productId} last={i === products.length - 1}
              subtitle={left > 0 ? `есть ${formatQty(left, p.unit)}` : 'нет на складе'} tone={left > 0 ? 'normal' : 'warning'}
              onPress={() => { setProductId(p.id); setError(null); }} />
          );
        })}
      </Group>
      <Group title={product ? `Количество · ${product.name}` : 'Количество'}>
        <Stepper value={qty} onChange={setQty} unit={product?.unit ?? 'box'} />
      </Group>
      {withPrice ? (
        <Field value={price} onChangeText={setPrice} keyboardType="decimal-pad" accessibilityLabel="Цена"
          placeholder={`Цена за ${product?.unit === 'kg' ? 'кг' : 'коробку'}, ₽ (необязательно)`} />
      ) : null}
      {error ? <Message tone="error" text={error} /> : null}
      <PrimaryButton title={addTitle} onPress={handleAdd} />
    </>
  );
}

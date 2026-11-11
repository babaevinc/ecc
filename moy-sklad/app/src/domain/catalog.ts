// Catalog rules for the owner's «Товары и склады» screen: names, units, kinds.
// No imports: Node can run it with --experimental-strip-types.

export const NAME_MAX = 80;

export const UNIT_OPTIONS = [
  { value: 'box', label: 'Коробки' },
  { value: 'kg', label: 'Килограммы' },
];

export const KIND_OPTIONS = [
  { value: 'warehouse', label: 'Склад' },
  { value: 'market_point', label: 'Точка на рынке' },
];

export type NameCheck = { ok: true; value: string } | { ok: false; error: string };

const key = (name: string): string => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');

/**
 * A name for a product or warehouse: trimmed, inner spaces collapsed, 1–80 characters, and not used
 * by another item (letter case and extra spaces do not make a name different).
 */
export function checkName(input: string, others: readonly { id: string; name: string }[], selfId?: string): NameCheck {
  const value = input.trim().replace(/\s+/g, ' ');
  if (!value) return { ok: false, error: 'Введите название' };
  if (value.length > NAME_MAX) return { ok: false, error: `Название — не длиннее ${NAME_MAX} символов` };
  if (others.some(o => o.id !== selfId && key(o.name) === key(value))) return { ok: false, error: 'Такое название уже есть' };
  return { ok: true, value };
}

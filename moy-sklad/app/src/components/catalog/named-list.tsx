// A list of named things (products, warehouses) the owner can add to, rename, archive and delete.
// Tap an item to edit it in place; deleting takes two taps.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useToast } from '@/components/toast';
import { Field, Group, Message, PrimaryButton, Row, Segmented, SmallButton } from '@/components/ui';
import { checkName, NAME_MAX } from '@/domain/catalog';
import { userMessage } from '@/state/use-stock-data';
import { space } from '@/theme';

export type NamedItem = { id: string; name: string; archived: boolean; option: string; note?: string };
type Option = { value: string; label: string };

type Props = {
  title: string;
  items: NamedItem[];
  options: Option[];
  addPlaceholder: string;
  addTitle: string;
  emptyText: string;
  /** Why the option (unit/kind) of this item cannot change, or null when it can. */
  optionLocked?: (item: NamedItem) => string | null;
  onAdd: (name: string, option: string) => Promise<void>;
  onSave: (item: NamedItem, name: string, option: string) => Promise<void>;
  onArchive: (item: NamedItem, archived: boolean) => Promise<void>;
  onDelete: (item: NamedItem) => Promise<void>;
};

export function NamedList({ title, items, options, addPlaceholder, addTitle, emptyText, optionLocked, onAdd, onSave, onArchive, onDelete }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [option, setOption] = useState(options[0].value);
  const [newName, setNewName] = useState('');
  const [newOption, setNewOption] = useState(options[0].value);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const label = (value: string) => options.find(o => o.value === value)?.label ?? value;
  const active = items.filter(i => !i.archived);
  const archived = items.filter(i => i.archived);

  async function run(action: () => Promise<void>, done: string, after?: () => void) {
    setBusy(true);
    try {
      await action();
      toast('success', done);
      after?.();
    } catch (e) {
      toast('error', userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: NamedItem) {
    setEditing(item.id);
    setName(item.name);
    setOption(item.option);
    setConfirm(null);
  }

  function handleSave(item: NamedItem) {
    const check = checkName(name, items, item.id);
    if (!check.ok) return toast('error', check.error);
    if (check.value === item.name && option === item.option) return setEditing(null);
    run(() => onSave(item, check.value, option), 'Сохранено', () => setEditing(null));
  }

  function handleDelete(item: NamedItem) {
    if (confirm !== item.id) return setConfirm(item.id);
    setConfirm(null);
    run(() => onDelete(item), `Удалено: ${item.name}`, () => setEditing(null));
  }

  function handleAdd() {
    const check = checkName(newName, items);
    if (!check.ok) return toast('error', check.error);
    run(() => onAdd(check.value, newOption), `Добавлено: ${check.value}`, () => setNewName(''));
  }

  return (
    <>
      <Group title={title}>
        {active.length ? active.map((item, i) => {
          const last = i === active.length - 1;
          if (editing !== item.id) {
            return <Row key={item.id} title={item.name} subtitle={[label(item.option), item.note].filter(Boolean).join(' · ')} last={last} chevron onPress={() => startEdit(item)} />;
          }
          const locked = optionLocked?.(item) ?? null;
          return (
            <View key={item.id} style={styles.edit}>
              <Field value={name} onChangeText={setName} accessibilityLabel={`Название: ${item.name}`} maxLength={NAME_MAX} autoFocus style={styles.flat} />
              {locked ? <Message tone="info" text={`${label(item.option)}. ${locked}`} /> : <Segmented value={option} onChange={setOption} options={options} />}
              <View style={styles.actions}>
                <SmallButton title="Сохранить" tone="accent" busy={busy} onPress={() => handleSave(item)} />
                <SmallButton title="В архив" busy={busy} onPress={() => run(() => onArchive(item, true), `В архиве: ${item.name}`, () => setEditing(null))} label={`В архив: ${item.name}`} />
                <SmallButton title={confirm === item.id ? 'Точно удалить?' : 'Удалить'} tone={confirm === item.id ? 'danger' : 'plain'} busy={busy} onPress={() => handleDelete(item)} label={`Удалить: ${item.name}`} />
                <SmallButton title="Отмена" onPress={() => setEditing(null)} />
              </View>
            </View>
          );
        }) : <Row title={emptyText} last />}
      </Group>

      <Group title={`Добавить · ${title.toLowerCase()}`}>
        <View style={styles.edit}>
          <Field value={newName} onChangeText={setNewName} placeholder={addPlaceholder} accessibilityLabel={addPlaceholder} maxLength={NAME_MAX} style={styles.flat} />
          <Segmented value={newOption} onChange={setNewOption} options={options} />
        </View>
      </Group>
      <PrimaryButton title={addTitle} onPress={handleAdd} busy={busy} />

      {archived.length ? (
        <>
          <View style={styles.gap} />
          <Group title={`Архив · ${title.toLowerCase()}`}>
            {archived.map((item, i) => (
              <Row key={item.id} title={item.name} subtitle={label(item.option)} value="Вернуть" last={i === archived.length - 1}
                onPress={() => run(() => onArchive(item, false), `Возвращено: ${item.name}`)} />
            ))}
          </Group>
        </>
      ) : null}
      <View style={styles.gap} />
    </>
  );
}

const styles = StyleSheet.create({
  edit: { paddingHorizontal: space.l, paddingTop: space.m },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingBottom: space.m },
  gap: { height: space.l },
  // The card already indents its content; the field keeps only its own height.
  flat: { paddingHorizontal: 0 },
});

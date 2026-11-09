// Input for scanners in keyboard mode (Bluetooth/USB, terminals): they type the code and press Enter.
import { useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, TextInput } from 'react-native';

import { space, type, usePalette } from '@/theme';

type Props = { onScan: (raw: string) => void; placeholder?: string };

export function ScanField({ onScan, placeholder = 'Отсканируйте код или введите вручную' }: Props) {
  const c = usePalette();
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const [text, setText] = useState('');

  function handleSubmit() {
    const raw = text;
    setText('');
    if (raw.trim()) onScan(raw);
    ref.current?.focus(); // stay ready for the next scan
  }

  return (
    <TextInput
      ref={ref}
      value={text}
      onChangeText={setText}
      onSubmitEditing={handleSubmit}
      submitBehavior="submit"
      autoFocus
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="done"
      placeholder={placeholder}
      placeholderTextColor={c.secondary}
      accessibilityLabel="Поле сканера"
      style={[styles.field, type.body, { backgroundColor: c.card, color: c.text, borderColor: c.accent }]}
    />
  );
}

const styles = StyleSheet.create({
  field: { height: 52, borderRadius: 12, borderWidth: 2, paddingHorizontal: space.l, marginBottom: space.m },
});

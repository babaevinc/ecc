// Small iOS-style building blocks shared by all screens.
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { stepQty, type Unit } from '@/domain/stock';
import { space, type, usePalette } from '@/theme';

type ScreenProps = { title: string; children: ReactNode; refreshing?: boolean; onRefresh?: () => void; right?: ReactNode };

export function Screen({ title, children, refreshing, onRefresh, right }: ScreenProps) {
  const c = usePalette();
  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[type.largeTitle, { color: c.text }]}>{title}</Text>
          {right}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  const c = usePalette();
  return (
    <View style={styles.groupWrap}>
      {title ? <Text style={[type.caption, styles.groupTitle, { color: c.secondary }]}>{title}</Text> : null}
      <View style={[styles.group, { backgroundColor: c.card }]}>{children}</View>
    </View>
  );
}

type RowProps = {
  title: string;
  subtitle?: string;
  value?: string;
  tone?: 'normal' | 'warning';
  selected?: boolean;
  last?: boolean;
  onPress?: () => void;
};

export function Row({ title, subtitle, value, tone = 'normal', selected, last, onPress }: RowProps) {
  const c = usePalette();
  const body = (
    <View style={[styles.row, !last && { borderBottomColor: c.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.rowText}>
        <Text style={[type.body, { color: c.text }]}>{title}</Text>
        {subtitle ? <Text style={[type.footnote, { color: tone === 'warning' ? c.warning : c.secondary }]}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={[type.bodyBold, { color: c.text }]}>{value}</Text> : null}
      {selected ? <Text style={[type.bodyBold, { color: c.accent }]}>✓</Text> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress}
      style={({ pressed }) => pressed && { backgroundColor: c.fill }}>
      {body}
    </Pressable>
  );
}

type Option = { value: string; label: string };

export function Segmented({ options, value, onChange }: { options: Option[]; value: string; onChange: (v: string) => void }) {
  const c = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segmentScroll}
      contentContainerStyle={[styles.segment, { backgroundColor: c.fill }]}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
            style={[styles.segmentItem, on && { backgroundColor: c.segmentOn }]}>
            <Text style={[type.footnote, { color: c.text, fontWeight: on ? '600' : '500' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Stepper({ value, onChange, unit }: { value: string; onChange: (v: string) => void; unit: Unit }) {
  const c = usePalette();
  const button = (label: string, delta: number, a11y: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={() => onChange(stepQty(value, delta))}
      style={[styles.stepButton, { backgroundColor: c.tint }]}>
      <Text style={[styles.stepLabel, { color: c.accent }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {button('−', -1, 'Уменьшить на 1')}
      <TextInput value={value} onChangeText={onChange} keyboardType={unit === 'kg' ? 'decimal-pad' : 'number-pad'}
        placeholder={unit === 'kg' ? 'Килограммов' : 'Коробок'} placeholderTextColor={c.secondary}
        accessibilityLabel="Количество" style={[styles.stepInput, type.bodyBold, { backgroundColor: c.card, color: c.text }]} />
      {button('+', 1, 'Увеличить на 1')}
    </View>
  );
}

export function Field(props: ComponentProps<typeof TextInput>) {
  const c = usePalette();
  return <TextInput placeholderTextColor={c.secondary} {...props} style={[styles.field, type.body, { backgroundColor: c.card, color: c.text }, props.style]} />;
}

export function PrimaryButton({ title, onPress, busy, disabled }: { title: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const c = usePalette();
  const off = disabled || busy;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} disabled={off} onPress={onPress}
      style={({ pressed }) => [styles.primary, { backgroundColor: c.accent, opacity: off ? 0.5 : pressed ? 0.75 : 1 }]}>
      {busy ? <ActivityIndicator color={c.onAccent} /> : <Text style={[type.bodyBold, { color: c.onAccent }]}>{title}</Text>}
    </Pressable>
  );
}

export function Banner({ title, text, onPress }: { title: string; text: string; onPress?: () => void }) {
  const c = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.banner, { backgroundColor: c.warningBg }]}>
      <Text style={[type.bodyBold, { color: c.text }]}>{title}</Text>
      <Text style={[type.footnote, { color: c.secondary }]}>{text}</Text>
    </Pressable>
  );
}

export function Message({ tone, text }: { tone: 'error' | 'success' | 'info'; text: string }) {
  const c = usePalette();
  const color = tone === 'error' ? c.danger : tone === 'success' ? c.accent : c.secondary;
  return <Text accessibilityLiveRegion="polite" style={[type.footnote, styles.message, { color }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { paddingHorizontal: space.l, paddingBottom: 120 },
  // On web the tab bar floats at the top, so the large title starts below it.
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Platform.OS === 'web' ? 92 : space.s, marginBottom: space.l },
  groupWrap: { marginBottom: space.xl },
  groupTitle: { marginLeft: space.l, marginBottom: space.s },
  group: { borderRadius: 12, overflow: 'hidden' },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: 11, marginHorizontal: space.l },
  rowText: { flex: 1, minWidth: 0 },
  segmentScroll: { flexGrow: 0, marginBottom: space.l },
  segment: { flexDirection: 'row', padding: 2, borderRadius: 10, gap: 2 },
  segmentItem: { paddingHorizontal: space.m, paddingVertical: 7, borderRadius: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  stepButton: { width: 56, height: 48, flexShrink: 0, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontSize: 26, fontWeight: '600' },
  stepInput: { flex: 1, minWidth: 0, height: 48, borderRadius: 10, textAlign: 'center' },
  field: { height: 48, borderRadius: 10, paddingHorizontal: space.l, marginBottom: space.m },
  primary: { height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: space.l },
  banner: { borderRadius: 14, padding: space.l, marginBottom: space.l, gap: 2 },
  message: { marginTop: space.m },
});

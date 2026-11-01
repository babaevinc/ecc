// iOS grouped look, shared with the web prototype: grey ground, white groups, hairline separators.
import { StyleSheet, useColorScheme } from 'react-native';

const light = {
  background: '#F2F2F7',
  card: '#FFFFFF',
  text: '#000000',
  secondary: '#8A8A8E',
  separator: 'rgba(60,60,67,0.18)',
  fill: 'rgba(118,118,128,0.12)',
  segmentOn: '#FFFFFF',
  accent: '#248A3D',
  onAccent: '#FFFFFF',
  tint: 'rgba(36,138,61,0.12)',
  danger: '#FF3B30',
  warning: '#FF9500',
  warningBg: 'rgba(255,149,0,0.16)',
  blue: '#007AFF',
};

export type Palette = typeof light;

const dark: Palette = {
  background: '#000000',
  card: '#1C1C1E',
  text: '#FFFFFF',
  secondary: '#8D8D93',
  separator: 'rgba(84,84,88,0.6)',
  fill: 'rgba(118,118,128,0.24)',
  segmentOn: '#636366',
  accent: '#30D158',
  onAccent: '#FFFFFF',
  tint: 'rgba(48,209,88,0.16)',
  danger: '#FF453A',
  warning: '#FF9F0A',
  warningBg: 'rgba(255,159,10,0.2)',
  blue: '#0A84FF',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const;

export const type = StyleSheet.create({
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.3 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 17 },
  bodyBold: { fontSize: 17, fontWeight: '600' },
  footnote: { fontSize: 13 },
  caption: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.3 },
});

// On-screen QR preview drawn with plain Views (no SVG dependency): each row is split into runs of
// light and dark modules, so a typical batch label needs a few hundred Views, not thousands.
import { StyleSheet, View } from 'react-native';

import type { QrMatrix } from '@/domain/label';

type Props = { matrix: QrMatrix; size: number; label: string };

type Run = { dark: boolean; length: number };

function rowRuns(matrix: QrMatrix, y: number): Run[] {
  const runs: Run[] = [];
  for (let x = 0; x < matrix.size; x++) {
    const dark = !!matrix.data[y * matrix.size + x];
    const last = runs[runs.length - 1];
    if (last && last.dark === dark) runs[runs.length - 1] = { dark, length: last.length + 1 };
    else runs.push({ dark, length: 1 });
  }
  return runs;
}

const QUIET = 2;

export function QrCode({ matrix, size, label }: Props) {
  const cell = size / (matrix.size + QUIET * 2);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}
      style={[styles.box, { width: size, height: size, padding: cell * QUIET }]}>
      {Array.from({ length: matrix.size }, (_, y) => (
        <View key={y} style={[styles.row, { height: cell }]}>
          {rowRuns(matrix, y).map((r, i) => (
            <View key={i} style={{ width: r.length * cell, height: cell, backgroundColor: r.dark ? '#000' : '#fff' }} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Always black on white, also in dark mode: scanners need the contrast.
  box: { backgroundColor: '#fff', borderRadius: 8 },
  row: { flexDirection: 'row' },
});

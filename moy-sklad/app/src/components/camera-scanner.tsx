// Phone camera scanner: barcodes on supplier boxes and the QR on our batch labels.
import { CameraView, useCameraPermissions, type BarcodeType } from 'expo-camera';
import { StyleSheet, View } from 'react-native';

import { Message, PrimaryButton } from '@/components/ui';
import { space } from '@/theme';

const BARCODE_TYPES: BarcodeType[] = ['qr', 'ean13', 'ean8', 'upc_a', 'code128', 'code39', 'datamatrix', 'itf14'];

type Props = { onScan: (raw: string) => void; paused: boolean };

export function CameraScanner({ onScan, paused }: Props) {
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) return <Message tone="info" text="Проверяем доступ к камере…" />;
  if (!permission.granted) {
    return (
      <View>
        <Message tone="info" text="Камера нужна, чтобы сканировать этикетки на коробках и партиях." />
        {permission.canAskAgain
          ? <PrimaryButton title="Разрешить камеру" onPress={requestPermission} />
          : <Message tone="error" text="Доступ к камере запрещён. Разрешите его в настройках телефона." />}
      </View>
    );
  }
  return (
    <View style={styles.frame} accessibilityLabel="Камера: наведите на штрихкод или QR-код">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={paused ? undefined : result => onScan(result.data)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 280, borderRadius: 14, overflow: 'hidden', marginBottom: space.l, backgroundColor: '#000' },
});

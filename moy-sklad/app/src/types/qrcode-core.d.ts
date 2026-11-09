// The pure QR encoder inside the `qrcode` package. Imported directly because the package's main
// entry pulls in Node-only renderers (fs, streams) that do not exist in React Native.
declare module 'qrcode/lib/core/qrcode' {
  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
  export function create(text: string, options?: { errorCorrectionLevel?: ErrorCorrectionLevel }): {
    modules: { size: number; data: Uint8Array };
  };
}

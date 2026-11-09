// Prints a self-contained HTML document through the system print dialog: AirPrint on iOS, the
// Android print service, and the browser dialog on web (expo-print's web build ignores `html`
// and prints the whole app page, so web gets its own hidden-iframe path).
import * as Print from 'expo-print';
import { Platform } from 'react-native';

import { LABEL_SIZE_MM } from '@/domain/label';

const MM_TO_PT = 72 / 25.4;
const IFRAME_CLEANUP_MS = 60_000;

function printOnWeb(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        frame.remove();
        reject(new Error('print frame is not available'));
        return;
      }
      win.focus();
      win.print();
      // print() blocks in most browsers; keep the frame a while for those where it does not.
      setTimeout(() => frame.remove(), IFRAME_CLEANUP_MS);
      resolve();
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

/** iOS rejects with "Printing did not complete" when the user closes the dialog without printing. */
export function isPrintCancelled(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /did not complete|cancel/i.test(message);
}

/** Opens the print dialog for a label-sized HTML document. Cancelling the dialog is not an error. */
export async function printLabels(html: string): Promise<void> {
  if (Platform.OS === 'web') return printOnWeb(html);
  await Print.printAsync({
    html,
    width: Math.round(LABEL_SIZE_MM.width * MM_TO_PT),
    height: Math.round(LABEL_SIZE_MM.height * MM_TO_PT),
  });
}

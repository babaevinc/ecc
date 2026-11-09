// Printable batch labels: a QR code with MS:B:<batch id> plus the facts a storekeeper reads by eye.
// Pure functions (no React, no I/O) so they run under `node --experimental-strip-types` in tests.

/** A QR matrix as produced by the `qrcode` package: `size`×`size` modules, row-major, 1 = dark. */
export type QrMatrix = { size: number; data: ArrayLike<number> };

export type LabelInfo = {
  /** Text encoded in the QR code, e.g. `MS:B:<uuid>`. */
  code: string;
  product: string;
  /** Already formatted for people, e.g. «4 кор.». */
  qty: string;
  /** ISO date, YYYY-MM-DD. */
  receivedOn: string;
  warehouse: string;
  supplier: string | null;
};

export const MAX_COPIES = 50;
/** Common thermal label size (58×40 mm); ordinary printers print it on a page corner. */
export const LABEL_SIZE_MM = { width: 58, height: 40 } as const;
const QUIET_ZONE = 2;

export function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_COPIES, Math.max(1, Math.round(value)));
}

/** «1 этикетку», «3 этикетки», «5 этикеток» — the accusative form used on the print button. */
export function labelsCount(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'этикетку'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'этикетки' : 'этикеток';
  return `${n} ${word}`;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

const ruDate = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** The QR matrix as a crisp SVG: one path of 1×1 squares, with a quiet zone around it. */
export function qrSvg(matrix: QrMatrix): string {
  const { size, data } = matrix;
  const full = size + QUIET_ZONE * 2;
  const parts: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) parts.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges">`
    + `<rect width="${full}" height="${full}" fill="#fff"/><path fill="#000" d="${parts.join('')}"/></svg>`;
}

/** A complete HTML document with `copies` identical labels, one per printed page. */
export function labelHtml(info: LabelInfo, qr: QrMatrix, copies: number): string {
  const { width, height } = LABEL_SIZE_MM;
  const meta = [`Приход ${ruDate(info.receivedOn)}`, info.warehouse, info.supplier].filter(Boolean).map(t => escapeHtml(String(t)));
  const label = `<section class="label"><div class="qr">${qrSvg(qr)}</div><div class="text">`
    + `<div class="product">${escapeHtml(info.product)}</div><div class="qty">${escapeHtml(info.qty)}</div>`
    + meta.map(m => `<div class="meta">${m}</div>`).join('')
    + `<div class="id">${escapeHtml(info.code.slice(5, 13))}</div></div></section>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Этикетка партии</title><style>`
    + `@page{size:${width}mm ${height}mm;margin:0}`
    + `*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#000}`
    + `.label{width:${width}mm;height:${height}mm;padding:2mm;display:flex;gap:2mm;align-items:center;overflow:hidden;page-break-after:always;break-after:page}`
    + `.label:last-child{page-break-after:auto;break-after:auto}`
    + `.qr{width:24mm;height:24mm;flex:none}.qr svg{width:100%;height:100%;display:block}`
    + `.text{min-width:0;flex:1;line-height:1.15}.product{font-size:13pt;font-weight:700;overflow-wrap:anywhere}`
    + `.qty{font-size:12pt;font-weight:700;margin:0.5mm 0 1mm}.meta{font-size:7.5pt;overflow-wrap:anywhere}`
    + `.id{font-size:6.5pt;font-family:Menlo,monospace;margin-top:1mm;color:#333}`
    + `</style></head><body>${Array.from({ length: clampCopies(copies) }, () => label).join('')}</body></html>`;
}

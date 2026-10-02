/**
 * Hardware smoke panel (P1) — ADVISORY, owner-run manual check.
 *
 * Not a route: mounted as an overlay only when the URL carries `?hardware=1`
 * (see `App.tsx`). Drives `NiimbotTransport` + `@mmote/niimbluelib` against a
 * real NIIMBOT printer from the app's own origin (localhost is a secure
 * context, so Web Bluetooth works). Chrome/Edge only.
 *
 *     bun run dev        # open http://localhost:5173/?hardware=1
 *
 * Optional query params: `?hardware=1&density=3&labelType=1&rows=384`
 *   - `rows` = printhead row width in dots. 384 fits 48 mm @ 203 dpi.
 *
 * Prints a 3-page job (quantities [1,1,1]) of visibly different pages so you can
 * confirm order, then a single band. `printEnd()` runs in a `finally` (paper cut
 * / state reset). This exercises the adapter only — the real canvas render
 * pipeline is P4.
 */
import { useEffect, useRef, useState } from 'react';
import type { EncodedImage, ImageRow } from '@mmote/niimbluelib';
import { NiimbotTransport } from '../../print/niimbotAdapter';
import type { PrintJob, PrintPage } from '../../print/transport';

type LogLine = { kind: 'info' | 'error'; text: string };

/**
 * Minimal 5x7 bitmap font — just what "HELLO WORLD" needs. `#` = black.
 * (P4 replaces this with real text rendering; this is only for the smoke page.)
 */
const FONT: Record<string, string[]> = {
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '# # #', ' # # '],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
};

/**
 * Rasterize a line of text into a `wid x height` black/white bitmap.
 * White pixels stay `false`; the encoder turns fully-white rows into `'void'`.
 */
export function rasterizeText(text: string, wid: number, height: number, scale: number): boolean[][] {
  const glyphs = text.toUpperCase().split('').map((ch) => FONT[ch] ?? FONT[' ']);
  const glyphW = 5;
  const gap = 1;
  const textW = (glyphs.length * glyphW + (glyphs.length - 1) * gap) * scale;
  const textH = 7 * scale;
  const startX = Math.max(0, Math.floor((wid - textW) / 2));
  const startY = Math.max(0, Math.floor((height - textH) / 2));

  const pixels: boolean[][] = Array.from({ length: height }, () =>
    Array.from({ length: wid }, () => false),
  );

  glyphs.forEach((glyph, g) => {
    for (let gy = 0; gy < 7; gy += 1) {
      for (let gx = 0; gx < glyphW; gx += 1) {
        if (glyph[gy][gx] !== '#') {
          continue;
        }
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const y = startY + gy * scale + sy;
            const x = startX + (g * (glyphW + gap) + gx) * scale + sx;
            if (y >= 0 && y < height && x >= 0 && x < wid) {
              pixels[y][x] = true;
            }
          }
        }
      }
    }
  });
  return pixels;
}

/**
 * Encode a black/white bitmap into niimbluelib's bit-plane rows.
 *
 * Mirrors what `ImageEncoder.encode` produces (P4 uses that for real):
 * - `cols` padded to a multiple of 8; bytes are MSB-first (`1 << (7 - bit)`).
 * - fully-white rows → `dataType: 'void'` (sent as `printEmptyRow`) with NO row
 *   data; anything else → `'pixels'`.
 * - consecutive identical rows collapse into `repeat`.
 */
export function encodeBitmap(pixels: boolean[][], cols: number): EncodedImage {
  const width = pixels[0]?.length ?? cols;
  const paddedCols = Math.ceil(width / 8) * 8;
  const bytesPerRow = paddedCols / 8;
  const rows: ImageRow[] = [];

  pixels.forEach((row, y) => {
    let blackPixelsCount = 0;
    let rowDataBlack: Uint8Array | undefined;
    for (let byte = 0; byte < bytesPerRow; byte += 1) {
      let octet = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const x = byte * 8 + bit;
        if (x < width && row[x]) {
          octet |= 1 << (7 - bit);
          blackPixelsCount += 1;
        }
      }
      if (octet !== 0) {
        rowDataBlack ??= new Uint8Array(bytesPerRow);
        rowDataBlack[byte] = octet;
      }
    }

    const isVoid = blackPixelsCount === 0;
    const last = rows[rows.length - 1];
    const sameAsLast =
      last !== undefined &&
      last.dataType === (isVoid ? 'void' : 'pixels') &&
      (isVoid || u8Equal(last.rowDataBlack, rowDataBlack));

    if (sameAsLast) {
      last.repeat += 1;
      return;
    }
    rows.push({
      dataType: isVoid ? 'void' : 'pixels',
      rowNumber: y,
      repeat: 1,
      blackPixelsCount,
      redPixelsCount: 0,
      rowDataBlack,
    });
  });

  return { pageColor: 0, cols: paddedCols, rows: pixels.length, rowsData: rows };
}

function u8Equal(a?: Uint8Array, b?: Uint8Array): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, i) => value === b[i]);
}

/** ASCII preview of an encoded page (no canvas needed; for the smoke log). */
function renderPreview(page: EncodedImage): string {
  const cols = page.cols;
  const maxRows = 40;
  const step = Math.max(1, Math.ceil(page.rows / maxRows));
  const lines: string[] = [];
  let row = 0;
  for (const encoded of page.rowsData) {
    for (let rep = 0; rep < encoded.repeat; rep += 1) {
      if (row % step === 0 && lines.length < maxRows) {
        if (encoded.dataType === 'pixels') {
          let line = '';
          for (let x = 0; x < cols; x += 1) {
            const byte = x >> 3;
            const bit = x & 7;
            const black = encoded.rowDataBlack?.[byte] !== undefined &&
              (encoded.rowDataBlack[byte] & (1 << (7 - bit))) !== 0;
            line += black ? '#' : '.';
          }
          lines.push(line);
        } else {
          lines.push('·'.repeat(Math.min(cols, 12)) + ` <${encoded.dataType}>`);
        }
      }
      row += 1;
    }
  }
  return lines.join('\n');
}

/** One coherent, centred "HELLO WORLD" page for the smoke test. */
export function helloWorldPage(cols: number, height: number): EncodedImage {
  const text = 'HELLO WORLD';
  const glyphW = 5;
  const gap = 1;
  const textCells = text.length * glyphW + (text.length - 1) * gap; // 65
  // Fit both dimensions with a margin; at least 1x.
  const scale = Math.max(
    1,
    Math.floor(Math.min(cols / (textCells + 4), height / 12)),
  );
  return encodeBitmap(rasterizeText(text, cols, height, scale), cols);
}

function readNumber(params: URLSearchParams, key: string, fallback: number): number {
  const value = Number(params.get(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function HardwareSmoke() {
  const transportRef = useRef<NiimbotTransport | undefined>(undefined);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);

  const push = (kind: LogLine['kind'], text: string): void => {
    setLines((prev) => [...prev, { kind, text }]);
  };
  const info = (text: string): void => push('info', text);
  const fail = (text: string): void => push('error', text);

  useEffect(() => {
    const transport = new NiimbotTransport({ transport: 'bluetooth' });
    transportRef.current = transport;
    const offStatus = transport.onStatus((status) =>
      info(`status ${JSON.stringify(status)}`),
    );
    const offProgress = transport.onProgress((progress) =>
      info(`progress ${JSON.stringify(progress)}`),
    );
    return () => {
      offStatus();
      offProgress();
      void transport.disconnect().catch(() => undefined);
      transportRef.current = undefined;
    };
  }, []);

  const run = async (): Promise<void> => {
    const transport = transportRef.current;
    if (!transport || busy) {
      return;
    }
    setBusy(true);
    try {
      const params = new URLSearchParams(location.search);
      const density = readNumber(params, 'density', 3);
      const labelType = readNumber(params, 'labelType', 1) as PrintJob['labelType'];
      const rowCount = readNumber(params, 'rows', 384);
      const copies = Math.max(1, Math.floor(readNumber(params, 'copies', 1)));

      info('connecting… accept the Bluetooth prompt');
      await transport.connect();

      const detected = transport.getDetected();
      info(`detected ${JSON.stringify(detected)}`);
      // Printhead dots: prefer the printer's own width; fall back to the param.
      const cols = detected.printheadPixels ?? rowCount;
      info(`page cols=${cols} rows=${rowCount} density=${density} labelType=${labelType}`);

      const page = helloWorldPage(cols, rowCount);
      info(
        `encoded page: cols=${page.cols} rows=${page.rows} ` +
          `rowsData=${page.rowsData.length} (void=${page.rowsData.filter((r) => r.dataType === 'void').length}, ` +
          `pixels=${page.rowsData.filter((r) => r.dataType === 'pixels').length})`,
      );
      info('preview:\n' + renderPreview(page));

      const pages: PrintPage[] = [{ data: page, quantity: copies }];
      async function* iter(): AsyncIterable<PrintPage> {
        for (const p of pages) {
          yield p;
        }
      }

      info(`printing 1 page × ${copies}…`);
      const result = await transport.print({
        totalPages: copies,
        pages: iter(),
        density,
        labelType,
      });
      info(`print done ${JSON.stringify(result)}`);

      await transport.disconnect();
      info('disconnected — smoke complete');
    } catch (error) {
      fail(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-white/95 p-6">
      <h1 className="text-lg font-semibold">Hardware smoke — NIIMBOT</h1>
      <p className="max-w-md text-center text-sm text-gray-600">
        Advisory P1 check: connects over Web Bluetooth and prints 3 pages. Open this
        page from <code>localhost</code> in Chrome/Edge.
      </p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="rounded bg-gray-900 px-5 py-2 text-sm text-white disabled:opacity-50"
      >
        {busy ? 'Working…' : 'Connect & print "HELLO WORLD"'}
      </button>
      <pre className="h-64 w-full max-w-2xl overflow-auto rounded bg-gray-900 p-3 text-xs leading-5 text-gray-100">
        {lines.length === 0 ? 'Ready.' : lines.map((line, i) => (
          <div key={i} className={line.kind === 'error' ? 'text-red-400' : undefined}>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

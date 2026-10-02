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

/** Canonical niimbluelib bit-plane page: `rowsData` in physical print order. */
function makePage(pageIndex: number, totalRows: number, rowCount: number): EncodedImage {
  const dataType: ImageRow['dataType'] = pageIndex === 0 ? 'check' : 'pixels';
  const rows: ImageRow[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const black = (row + pageIndex * 17) % 24 < 12;
    const rowDataBlack = new Uint8Array(Math.ceil(totalRows / 8));
    if (black) {
      rowDataBlack.fill(0xff);
    }
    rows.push({
      dataType,
      rowNumber: row,
      repeat: 1,
      blackPixelsCount: black ? totalRows : 0,
      redPixelsCount: 0,
      rowDataBlack,
    });
  }
  return { pageColor: 0, cols: totalRows, rows: rowCount, rowsData: rows };
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

      info('connecting… accept the Bluetooth prompt');
      await transport.connect();

      const detected = transport.getDetected();
      info(`detected ${JSON.stringify(detected)}`);
      // Printhead dots: prefer the printer's own width; fall back to the param.
      const cols = detected.printheadPixels ?? rowCount;
      info(`page cols=${cols} rows=${rowCount} density=${density} labelType=${labelType}`);

      const total = 3;
      const pages: PrintPage[] = [0, 1, 2].map((index) => ({
        data: makePage(index, cols, rowCount),
        quantity: 1,
      }));
      async function* iter(): AsyncIterable<PrintPage> {
        for (const page of pages) {
          yield page;
        }
      }

      info('printing 3 pages…');
      const result = await transport.print({
        totalPages: total,
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
        {busy ? 'Working…' : 'Connect & print 3 pages'}
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

# Phase 1 Action Plan — Foundation & comms spike (M0)

**Run:** `agent/2026-09-29_label-editor-v1` · **Owner:** Coordinator · **Plan ref:** `plan.md` P1
**Status:** DONE — commit `380be10`. Reviewed (review-alt + experimental-review, APPROVE). 119 tests green, tsc clean, build green.

## Scope (frozen)

1. Deps: `@mmote/niimbluelib@0.47.0` added (done via `bun add`, exact pin in `package.json` + `bun.lock`).
   - Other plan deps are deferred to the phase that consumes them (papaparse→P6, qrcode→P5, barcode→P5, idb→P2, immer→P2, fflate→P4/P8). Rationale: no dead deps; each phase verifies its own.
2. `.gitignore` += `agent/*/state.md` — **already present**, no change needed.
3. `src/core/hm.ts` + tests (zero React imports — headless engine).
4. `src/print/` transport contract + `MockTransport` + `niimbotAdapter` (adapter API locked).
5. Multi-page spike (hardcoded 3 pages → MockTransport) green.
6. Interop evidence: Vitest import of the CJS package **verified by coordinator** (probe passed); `bun run build` must stay green.

## Frozen contract — `src/print/transport.ts`

Type-only imports from `@mmote/niimbluelib` (erased at build; no runtime coupling in mock/tests).
`EncodedImage` is the niimbluelib bit-plane payload produced by the render pipeline (P4).

```ts
import type { EncodedImage, LabelType, PageColorType } from '@mmote/niimbluelib';

export interface PrintPage { data: EncodedImage; quantity: number }

export interface PrintJob {
  totalPages: number;                 // Σ quantity; niimbluelib needs it upfront
  pages: AsyncIterable<PrintPage>;    // lazy — invariant 9
  density?: number;
  labelType?: LabelType;
  pageColor?: PageColorType;
  signal?: AbortSignal;               // abort mid-job → printEnd() in finally
}

export interface PrintResult { pagesPrinted: number }

export type TransportState =
  | 'disconnected' | 'connecting' | 'connected' | 'printing' | 'error';

export interface PrinterStatus {
  state: TransportState;
  deviceName?: string;
  dpi?: number;                 // printer printhead dpi when known
  rollWidthHm?: number;         // printer-reported roll/label size, when known
  rollHeightHm?: number;
  batteryPercent?: number;
  error?: string;
}

export interface PrintProgress {
  page: number; pagesTotal: number;
  pagePrintProgress: number; pageFeedProgress: number;
}

export interface PrinterTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  print(job: PrintJob): Promise<PrintResult>;
  onStatus(listener: (status: PrinterStatus) => void): () => void;   // returns unsub
  onProgress(listener: (progress: PrintProgress) => void): () => void;
}
```

## Files

| File | Owner | Notes |
| --- | --- | --- |
| `src/core/hm.ts` | small-coder | `hm` type; `MM_PER_INCH=25.4`; `mmToHm`(round), `hmToMm`, `hmToPx(hm,dpi)`(round), `pxToHm(px,dpi)`, `roundHm`. Integer hm (invariant 5). |
| `src/core/hm.test.ts` | small-coder | round-trips, integer guarantee, px↔hm. |
| `src/print/transport.ts` | general | frozen contract above. |
| `src/print/mockTransport.ts` | general | implements contract; configurable delays/device/dpi; records jobs; emits status+progress; abort via `signal`. |
| `src/print/mockTransport.test.ts` | general | connect→print→disconnect, order/quantity, progress, abort. |
| `src/print/niimbotAdapter.ts` | general | `NiimbotTransport implements PrinterTransport`; injectable client factory; verified flow. |
| `src/print/niimbotAdapter.test.ts` | general | fake client orchestration (`printInit`→`printPage`→`waitForPageFinished`→`waitForFinished`→`printEnd` finally) + real `instantiateClient('virtual')` interop smoke. |
| `src/print/spike.test.ts` | tester | hardcoded 3-page job → MockTransport; asserts page count/order/progress/cancel. |

## niimbotAdapter — verified flow (from installed 0.47.0 d.ts)

- Constructor: `{ createClient?: () => NiimbotAbstractClient; transport?: NiimbotClientType = 'bluetooth'; connectOptions?: unknown; density?; labelType? }`.
  Default `createClient = () => instantiateClient(transport)`.
- `connect()`: `client.connect()`, wire `client.on('printprogress'|'connect'|'disconnect')`, publish status.
- `print(job)`:
  ```
  const taskType = client.getPrintTaskType();
  if (!taskType) throw new Error(...);
  const task = client.protocol.newPrintTask(taskType, { totalPages: job.totalPages, density, labelType, pageColor, statusPollIntervalMs: 100, statusTimeoutMs: 8000 });
  try {
    await task.printInit();
    for await (const page of job.pages) {
      if (job.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await task.printPage(page.data, page.quantity);
      await task.waitForPageFinished();
    }
    await task.waitForFinished();
    return { pagesPrinted: job.totalPages };
  } finally { await client.protocol.printEnd(); }
  ```
- `PrintProgressEvent` → our `PrintProgress`. `printEnd()` lands in `finally` (plan print pipeline).

## Constraints (constitution)

- `src/core/` imports **zero React**. `hm` is integer; no floats in doc.
- Adapter knows nothing of nodes/CSV/templates (invariant 8).
- Job iteration is lazy; never materialize all pages (invariant 9).
- Tests typechecked by `tsc`; keep clean under `noUnusedLocals/Parameters`; explicit `import { describe... } from 'vitest'`.

## Gate

1. `bun run test:run` green. 2. `bun run build` green. 3. Review (`review-alt`; parent pastes tsc/test/build evidence). 4. ≤2 fix rounds. 5. Semantic commit.

## Out of scope (parked)

Render pipeline / resolver / color+quantize (P4), real job runner + sequence generator + one-job guard + progress UI (P7), roll/dpi mismatch *UI* (P3; adapter exposes the data only). Hardware smoke = advisory, owner-run.

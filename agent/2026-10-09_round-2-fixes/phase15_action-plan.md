# P15 — Two-phase print progress (send / print): action plan

- Owner request 2026-10-19, verbatim: *"progress bar currently doesnt match the niim.blue reference.
  The reference correctly displays the sending progress and the printing progress. This seems to just
  show the print progress. Maybe we need 2x progress bar, one for send one for print."*
- Recon 2026-10-19 (scout, verified from the library source + the vendored reference): see
  "Recon facts" below. Those facts are taken as correct — do not re-verify.
- Base: `main` @ `f7d5b18`. Baseline `tsc` clean, **165 files / 2198 tests** green.

## Owner decisions (settled 2026-10-19)

1. **Two bars, job-wide and monotonic.** A **send** bar and a **print** bar, each aggregated across the
   whole job and never decreasing. (Not the reference's literal single flipping-label bar, and not
   per-page bars that reset — a 20-page job would look like it never finishes sending.)
2. **The mock gains a synthetic send curve** so `?mock=1` / `?printcsv=1` and the automated tests can
   show and assert the send bar. The real signal only ever comes from hardware.

## Recon facts (2026-10-19 — verified, do not re-verify)

### The reference (what the owner is comparing against)
- `references/niimblue/src/components/PrintPreview.svelte:45-48` — **one** state value:
  `{ progressType: 'send' | 'print'; percents: number }`; `:430-441` renders **one**
  `role="progressbar"` whose **label** flips between "Sending…" / "Printing…".
- Two listeners feed it (`:131-142`): `printprogress` → `{progressType:'print'}`;
  `printpacketprogress` → `{progressType:'send', percents: e.progress}`. Reset on end (`:96`).
- Labels: `references/niimblue/src/locale/dicts/en.json:205-206` = "Sending…" / "Printing…".
- So the reference is **one bar with a flipping label**; the owner wants **two**.

### The library contract (`@mmote/niimbluelib@0.47.0`)
- `events.d.ts:101-119` `PrintProgressEvent { page; pagesTotal; pagePrintProgress; pageFeedProgress }`
  ("printprogress") · `:144-146` `PrintPacketProgressEvent { progress /*0-100*/ }`
  ("printpacketprogress").
- **Send signal:** `print_tasks/AbstractPrintTask.js:106-116` — `makePacketProgressCallback(stepPercent=5)`
  emits `printpacketprogress` while a page's packets upload; installed on **every** task's `printPage`
  (`D110MV4PrintTask.js:37`, `B1PrintTask.js:24`, …). **Genuine bitmap-upload progress, NOT
  model-gated — it fires on the owner's D110M_V4.** It is **per `printPage`**: it restarts at 0 for
  every source page.
- **Print signal:** `packets/protocol.js:112,114` — the status poll inside `waitUntilFinished` emits
  `printprogress` (initial `(1,total,0,0)`, then per poll). Job-wide and cumulative.
- No "encode" event exists; we render before the transport is called.

### Our side (where the gap is)
- `src/print/niimbotAdapter.ts:345` wires **only** `printprogress` (+ connect/disconnect/heartbeat).
  **`printpacketprogress` is never subscribed**, so upload is a blank stretch.
- `src/print/transport.ts:121-142` `PrintProgress { page; pagesTotal; pagePrintProgress; pageFeedProgress }`
  — **no send field**; the interface (`:144-154`) exposes only `onStatus` / `onProgress`.
- `src/print/jobRunner.ts:114` — the only `'sending'` emit is **synthetic, pre-loop, `percent: 0`**;
  every real event maps to `phase: 'printing'` (`:134`, `:146`). `JobProgress = {page, pagesTotal,
  percent, phase}` (`:30-37`).
- `src/print/mockTransport.ts:191-201` — one event per physical copy, `pagePrintProgress: 100,
  pageFeedProgress: 100`, `pageFeedProgress` always 100 (i.e. the mock has **no** send phase).
- UI: `src/components/print/PrintDialog.tsx:121` (`progress: JobProgress | null`), `:393-398`
  (`handleProgress`), `:773-793` the single bar, `data-testid="print-progress-bar"`, label from
  `progress.phase` (`:783-788`).

### Facts that must be respected
- **`pageFeedProgress` is always 0 on D110M_V4** (`memory/print-transport.md:102`) → a *feed* bar would
  be permanently dead on the owner's printer. The send bar must use **`printpacketprogress`**, never
  `pageFeedProgress`.
- The **print** percent must keep the runner's monotonic clamp (`jobRunner.ts:132`) — the raw `page`
  is the known 1 → 0 → 1 non-monotonic value (`print-transport.md:32-40`).
- **D-27 stays open**: the print index is still the inferred 1-based physical-copy index; this phase
  does not verify it (grouped `quantity > 1` on hardware is still owed).

## Scope

One wave. Keep it minimal — no new abstraction beyond a second progress channel.

1. **Adapter** (`niimbotAdapter.ts`): subscribe `printpacketprogress` next to the existing
   `printprogress` wiring, forward `e.progress` (0-100) per page, and unsubscribe on teardown exactly
   like the other listeners.
2. **Transport contract** (`transport.ts`): carry the send percentage. Prefer a **separate**
   subscription (send and print are different phases with different lifetimes) over overloading
   `PrintProgress` — but either is acceptable if the alternative is cleaner; document the choice.
3. **Runner** (`jobRunner.ts`): track the current page index and project the per-page send percentage
   into a **job-wide monotonic** send percent: `((pageIndex - 1) + intraPage / 100) / pagesTotal * 100`,
   clamped non-decreasing. `JobProgress` carries both values (print percent unchanged in meaning).
   The existing synthetic `'sending'` phase emit (`:114`) either goes away or becomes honest — it must
   no longer claim `percent: 0` while nothing is sent.
4. **Mock** (`mockTransport.ts`): emit a synthetic send curve per page (a few steps, tied to the
   existing per-page delay so the harness shows it moving), then the existing print event.
5. **Dialog** (`PrintDialog.tsx`): two bars — "Sending n/N" and "Printing n/N" — with the print bar
   keeping `data-testid="print-progress-bar"` and the send bar a sibling testid. i18n keys under
   `print.*` (typed `t()`); the labels must not lie about a phase that has no progress yet.
6. **i18n** (`en.json`): new keys only; no key deletions.

## Tests (required)

- **Runner**: a multi-page job where send rises per page and never decreases; the aggregate at the last
  page's 100 % equals ~100 %; print keeps its monotonic clamp; the phases/labels sequence is honest.
  Update the existing pins (`jobRunner.test.ts:112-140` pins phases
  `['sending','printing',…]` and percents `[0,0,50,100,100]`) **deliberately**, not by deleting the
  assertions.
- **Adapter**: subscribing/unsubscribing and forwarding the packet event (fake client or the existing
  adapter test seam).
- **Mock**: emits a send curve that reaches 100 % before the page's print event.
- **Dialog**: both bars render with the expected widths at a known progress value; the labels are the
  new keys (`PrintDialog.test.tsx:387` currently asserts the single bar at 100 % — keep an equivalent
  assertion for the print bar).
- **Regression**: `batchJob.test.ts:256,308` gate cancel on `phase === 'printing'` — keep that
  behaviour (cancel must still be gated on the print phase) and keep the tests passing.

## Verification

- `tsc` clean; full suite green. Reviewer: `review` (a transport/progress change is logic-heavy).
- **Owner (manual, hardware):** the send bar should move during upload and hand over to the print bar;
  `?printcsv=1` (MockTransport, `pageDelayMs: 1500`, 3 pages) shows both bars moving; `?mock=1` too.
- Not verifiable here: D-27's grouped-`quantity > 1` copy index.

## Risks

- **R15-a** — the send bar resetting per page is the reference's behaviour; our job-wide aggregation is
  a deliberate divergence. Do not "fix" it back.
- **R15-b** — if the print percent and the send percent are fed through one monotonic clamp, the send
  bar freezes. They must be independent.
- **R15-c** — a send bar that cannot move on some other model would be worse than none: keep the
  print bar as the primary indicator and let the send bar be absent/hidden rather than dead-looking if
  a transport never reports it.
- **R15-d** — `pageFeedProgress` must not be reused as "send" (it is 0 on D110M_V4).

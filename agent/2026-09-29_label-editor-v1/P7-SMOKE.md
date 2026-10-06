# P7 Smoke — preview + batch print

**Run:** `agent/2026-09-29_label-editor-v1` · **Written:** 2026-10-06 · **Owner:** you (B1_PRO)
Fixtures: `p7-smoke-3rows.csv` (3 labels — **use this on hardware; don't waste paper**),
`p7-smoke-100rows.csv` (100 labels — automated/headed Mock only).

> Exit criterion is "a 100-label CSV job prints reliably". The **100** case is proven by the
> automated integration test `src/print/batchJob.test.ts` (grouped + interleaved + cancel). The
> hardware + headed runs use **3 rows** (your call) to save paper.

## A. Headed Mock (no printer)

1. `bun run dev` → open `http://localhost:5173/?mock=1`.
2. Create/open a label, add a text node bound to a CSV column, attach `p7-smoke-3rows.csv`.
3. `File → Print…` (or `Ctrl/Cmd+P`) → the dialog opens.
   - Expect: 3 rows listed with thumbnails (~50 dpi), `totalPages` = 3, order toggle, overrides.
   - Warnings: none for a normal label; roll/dpi mismatch only if the mock's roll differs.
4. Print → progress reaches **100%**, outcome "printed"; Mock records 3 pages.
5. Print again, **Cancel** mid-job → outcome "cancelled", transport back to connected, and a
   further Print still works (no wedged job).
6. Dev shortcut: the `?printcsv=1` harness mounts the dialog over a synthesised 3-row CSV doc with
   a delayed MockTransport (so Cancel is observable). `window.__printCsvSmoke.jobs()` lists jobs.
7. Confirm **no trust prompt appears** when the dialog is closed (mount gate), and that opening it
   does not execute templates for a plain-CSV doc (dec 42).

## B. Hardware (B1_PRO)

1. `bun run dev` (Windows bun) → open the app (no query params).
2. Connection chip → **Connect** → pick the printer (Web Bluetooth). Expect `connected`, 300 dpi,
   roll/density from the device. (The real transport never auto-connects — you must click.)
3. Open/create a **50×30** label (your roll), add a text node bound to a CSV column, attach
   `p7-smoke-3rows.csv`.
4. `File → Print…` (or `Ctrl/Cmd+P`) → dialog. Check the preview thumbnails and any warnings.
5. **Print** → watch progress → **3 labels** print; verify content/order per row.
6. **Cancel test:** Print again, click **Cancel** mid-job → printer stops, paper cuts cleanly
   (`printEnd` ran once), state returns to connected, no orphaned job; Print works again after.
7. **Narrow-label / offset:** print a label narrower than the 48 mm head (e.g. 25 mm) and use the
   **Offset** knobs (inner/outer, x/y) to centre it on the roll. No underfill warning is expected
   (the printer centres); the **printhead-overflow** warning should appear if you load a label
   wider than 567 dots.
8. **`printDirection` (D-04):** set a doc's print direction to `bottom` (and `right`) and print —
   the raster is pre-rotated 180° before encoding; confirm the physical orientation is correct.
9. **D-27 (progress granularity):** attach a row with `$times = 2` in **grouped** order and print;
   watch whether the progress bar counts *physical copies* or *pages*. Record what you see — the
   contract assumes 1-based physical-copy indices, which is inferred, not verified.

## Record

| Step | Result | Notes |
| ---- | ------ | ----- |
| A. headed Mock 3-row print | | |
| A. headed Mock cancel | | |
| A. no trust prompt when closed | | |
| B. connect + 3-label print | | |
| B. mid-job cancel clean | | |
| B. offset centring | | |
| B. printDirection bottom/right | | |
| B. D-27 progress granularity | | |

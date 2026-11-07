# P7 Verify — print-time colours (grayscale + red/black)

**Run:** `agent/2026-11-02_print-colours` · **Written:** 2026-11-08 · **Owner:** you (printer on hand)
Harness: `?printcolours` (dev-only overlay mounted by `src/App.tsx`; patterns live in
`src/components/dev/printColoursPatterns.ts`, panel in `PrintColoursSmoke.tsx`).
Fixtures: none to load — all three patterns are in-memory docs with deterministic,
generated images (no photo fixture in the repo).

> **Tape budget:** red/black stock is expensive — **one** red/black print. Every
> pixel-path question (palette bytes, flat-vs-diffuse, packet layout) is already
> settled by goldens and preview ≡ print; this run answers only the physical
> questions.
>
> **Status: grayscale 16-step printed (2026-11-08, density 3); long page and
> red/black still pending.** The harness preview is not hardware evidence. Fill
> the remaining Record rows from the physical output, never from the preview.

## A. Mock dry run (no printer)

1. `bun run dev` → open `http://localhost:5173/?printcolours`.
2. The panel shows a preview canvas plus **Pattern**, **Page colour**, **Transport**,
   **Connect** and **Print 1 page**.
3. Select each pattern and check the preview (rendered through the real
   `renderLabelPage` path at 100 dpi — a tone check before spending tape):
   - **Grayscale — 16 steps**: 16 grey bars (`255 − 17k`, level captions), a
     black→white gradient strip, a colour/photo stand-in, captions.
   - **Red & black — flat / diffuse**: black row, red row, alternating row, an
     8-step grey sweep, a red-tinted grey gradient, a red+grey gradient, `RED`
     and `BLACK` text. Preview pixels must be **exactly white / black / red**;
     the red-tinted strip is red/white only, with **no black**.
   - **Grayscale — 50×160 long**: the 16 bars at the top and a full-length
     gradient strip (the buffer stress case).
   - The page colour auto-selects with the pattern. Selecting **Mono** on a
     grayscale pattern should visibly drop to 1-bit — a quick check that the
     selector really drives the render.
4. Transport = **Mock** → **Connect** → **Print 1 page**. Expect a connected
   status, progress, and `printed 1 / 1 page(s)`.
5. Confirm the preview is not 1-bit for Grayscale and not grey for Red & black.
   A wrong palette here means stop — do not spend tape.

## B. Hardware (owner)

1. Load **standard mono stock** (50×30 mm is the pattern geometry).
2. `bun run dev` → `?printcolours`; Transport = **Real printer (Bluetooth)** →
   **Connect** → accept the browser's Bluetooth prompt.
3. **Grayscale — 16 steps** on standard stock: confirm **Page colour =
   Grayscale** → **Print 1 page**.
4. **Grayscale — 50×160 long** on standard stock (long roll): confirm
   **Grayscale** → **Print 1 page**. This is the buffer test —
   `sixteenGrayMaxBuffer` is parsed but not enforced by niimbluelib 0.49.
5. Load **red/black tape**. Select **Red & black — flat / diffuse**, confirm
   **Page colour = Red & black**, and print it **once**.
   - The harness cannot override label type. It builds with only
     `overrides: { pageColor }`, so it sends **no label-type override** and the
     library uses the printer-reported roll type. If the stock needs a different
     label type, use the normal `File → Print…` flow
     (RFID dims/type are printer advice, not a measurement).
6. **Density** (added after the first print): the harness offers the
   printer-reported range with `Printer default (n)` first. Print the grayscale
   16-step pattern at the default, then at a higher density if light steps look
   faint. Density is the printer's heat/energy setting; it does **not** change the
   ramp's level mapping. Record the density for every row.
7. Do **not** re-print the red/black page to "improve" it; record what came out.
   One pass is the plan's tape decision.

## What to look for

| Question | Where on the print | Pass looks like |
| --- | --- | --- |
| 16 distinct densities | Grayscale bars 0–15 | 16 visibly different steps; note which neighbouring levels merge, and where |
| Banding vs texture | Grayscale gradient strip / photo | Dither texture, not wide flat bands; judge acceptability, not perfection |
| Flat crispness | Grayscale captions; red/black bar rows + 8-step sweep | Sharp edges, no dither speckle on authored flat art |
| Red vs black density | Red/black bar rows; `RED` vs `BLACK` text | Note which ink is lighter/darker at the same coverage (thermal red is heat-selected, not pigment) |
| Mixed rows | Alternating row; red+grey gradient | Both inks present, recognisable mix — not mud or one ink only |
| Red-only dither | Red-tinted grey gradient | Red and white dots only — **no black pixels** |
| Long-page buffer | 50×160 mm strip, especially the lower half | Completes with no buffer error, stall or truncation; density equals the top |
| Paper / RFID | Any print on swapped stock | Manual paper selection works; no silent geometry mismatch — and **red/black mode on mono stock prints an intermediate grey ≈ levels 11–12** (observed), so page colour must match the stock |

## Record

| Date | Run | Pattern | Page colour | Printer / firmware | Observations | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| | A (Mock) | Grayscale — 16 steps | Grayscale | Mock | | |
| | A (Mock) | Red & black — flat / diffuse | Red & black | Mock | | |
| | A (Mock) | Grayscale — 50×160 long | Grayscale | Mock | | |
| 2026-11-08 | B (hardware) | Grayscale — 16 steps | Grayscale | owner printer, density 3 (default) | Levels **0–2 indistinguishable from paper**, **3 very faint**, usable ≈ **4–14**; on some stock **15 merges with 14 (sometimes 13)**. Density control added after this print. | **Partial** — ramp spans more than paper shows; **dynamic range requested (D-75)** |
| 2026-11-08 | B (hardware) | Red & black — flat / diffuse | Red & black | owner printer, **normal mono stock** | Prints an intermediate **grey ≈ grayscale levels 11–12** — not black/red. Mode assumes red/black media. | **Expected mismatch** — page colour must match the stock; red/black tape row still pending |
| | B (hardware) | Grayscale — 50×160 long | Grayscale | | | |
| | B (hardware) | Red & black — flat / diffuse | Red & black | | | |

**Owner verdict:** *(grayscale 16-step: usable 4–14 at density 3; dynamic-range option to be added later — D-75. Red/black on mono stock prints grey ≈ 11–12 — expected, page colour must match the stock. Long-page and red/black-tape rows still pending.)*

When the rows are filled: only a clean long-page print can retire **D-73**; only
the red/black row can confirm the palette calibration (weights are all `1` until
then) and the D-05 seam judgement. Do not close debt from the preview.

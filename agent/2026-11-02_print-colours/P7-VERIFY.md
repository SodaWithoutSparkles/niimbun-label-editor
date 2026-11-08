# P7 Verify — print-time colours (grayscale + red/black)

**Run:** `agent/2026-11-02_print-colours` · **Written:** 2026-11-08 · **Owner:** you (printer on hand)
Harness: `?printcolours` (dev-only overlay mounted by `src/App.tsx`; patterns live in
`src/components/dev/printColoursPatterns.ts`, panel in `PrintColoursSmoke.tsx`).
Fixtures: none to load — all patterns are in-memory docs with deterministic,
generated images (no photo fixture in the repo).

> **Tape budget:** red/black stock is expensive — the **P7 library-bug control is
> one red/black print**. Every pixel-path question (palette bytes,
> flat-vs-diffuse, packet layout) is already settled by goldens and preview ≡
> print; this run answers only the physical questions. The **P9 addendum below
> deliberately spends several labels** on the cluster/hue calibration.
>
> **Status: grayscale + 50 mm red/black calibration printed; the colour-boundary
> bars are a confirmed library bug — the author traced them to the printer
> trimming the packet tail, and a 48 mm control is now in the harness/repro
> (D-77). Long page is pending.** The harness preview is not hardware evidence. Fill
> the remaining Record rows from the physical output, never from the preview.
>
> **P8 follow-up (2026-11-08):** the owner confirmed 48 mm red/black prints
> clean. The print dialog now **clamps red/black pages to the printhead width by
> default** (`maxHeadHm` → exact 1:1 crop on the head axis), with a visible
> "Clamp to print head" toggle as the escape hatch for testing. Preview,
> thumbnails and the print job all use it (invariant 7); mono/grayscale pages are
> untouched. The upstream library fix is still pending (D-77).

## P9 addendum — duotone engine (2026-11-09)

**What changed.** Grayscale photos now diffuse **one scalar BT.601 plane**
(`diffuseRamp`), so saturated colours keep their own tone instead of collapsing.
Red/black photos are a **two-ink duotone separation** (`separateRedBlack`), not
the old RGB-vector palette: clustered 3×3 red cells (0 or ≥`5/9` coverage, ≥4
connected dots), black on the free dots as BT.601 darkness minus the red ink's
own darkness. Authored flat art is unchanged (point op). The P7 calibration
pattern remains the library-bug/coverage control; the patterns below test the
new separation.

**Print (red/black tape, 48 mm — the clamp is on by default):**

1. `redBlackClustersSmall` (2×2 + 3×3 footprints) and `redBlackClustersLarge`
   (4×4 + 6×6). Column headers are the **target** coverage
   (25/50/56/67/78/100 %); each cell caption is its **achieved** coverage. The
   harness reads the persisted `redBlackSettings`, so set the print-dialog
   sliders first — preview and job use the same values.
2. `redBlackHues` — six sample colours through the engine (A) vs the flat
   classifier (B), red→brown and pink→white ramps, pink-hue highlights at OKLab
   L 0.60–0.95, the neutral black ramp, and touching 2 mm red/black cells for
   registration.
3. One **grayscale photo** label on mono stock (normal print flow; the harness
   patterns are generated, not photo fixtures).

**Record:**

- Does an activated 3×3 cell at `5/9` (5 dots) develop solid red? Does `6/9`?
- Does cluster footprint change the floor — is 2×2 worse, are 4×4/6×6 blotchy?
- Do the pink highlights (L 0.85/0.95) keep red, or wash to paper? Does
  red→brown stay red longer than black?
- Is the neutral tone on the black ramp washed out or crushed, compared with
  the same step in grayscale/mono?
- Slider settings (`redIntensity %`, `blackDepth %`), density, printer/firmware,
  and a verdict per pattern.

**Tuning lever.** The two sliders are the user-facing lever; code constants
change only after this print. They act on the demands before halftoning, so a
slider cannot break the red dots' physical floor.

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
7. **Red/black calibration** (added after the tape print): select
   **Red & black — calibration** and print one label at the default density, then
   press **Print density sweep (N)** — it prints the same calibration label once
   per density in the reported range, with the density stamped in the caption.
   - Isolated red ramp (top band): red/white only; any black there is red
     overheat, not registration.
   - Coverage ladder (75/50/25/12/6): straight authored tone → printed red
     coverage; note where it stops being linear and where red starts turning
     black.
   - Vertical + horizontal black/red blocks: measure the boundary offset
     (~1–1.5 mm on the first print); compare across densities and directions.
   - Record which density keeps red red **and** black black.
8. Do **not** re-print the red/black page to "improve" it; record what came out.
   One pass is the plan's tape decision — the calibration sweep is the deliberate
   exception for D-77.

## What to look for

| Question | Where on the print | Pass looks like |
| --- | --- | --- |
| 16 distinct densities | Grayscale bars 0–15 | 16 visibly different steps; note which neighbouring levels merge, and where |
| Banding vs texture | Grayscale gradient strip / photo | Dither texture, not wide flat bands; judge acceptability, not perfection |
| Flat crispness | Grayscale captions; red/black bar rows + 8-step sweep | Sharp edges, no dither speckle on authored flat art |
| Red vs black density | Red/black bar rows; `RED` vs `BLACK` text | Note which ink is lighter/darker at the same coverage (thermal red is heat-selected, not pigment) |
| Cross-ink registration | Alternating row; black↔red boundaries | Edges should be clean; a strip of the previous bar's ink at a boundary is the **library** Mixed-row bug (observed ~1 byte, official app clean) — D-77 |
| Red coverage linearity | Calibration coverage ladder (75/50/25/12/6) | Coverage steps down roughly with the label; note where red turns black or disappears |
| Density window | Calibration sweep labels, caption `DENSITY n` | One density keeps red red **and** black black; note the range and the failure mode outside it |
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
| 2026-11-08 | B (hardware) | Red & black — flat / diffuse | Red & black | owner printer, **red/black tape**, density 3 | Solid black row and solid red row print correctly. Alternating row: bars 2/4/6 show **~1–1.5 mm of the previous bar's ink at the left edge**; bars 3/5 show ~1 mm red then black — the two inks are **misregistered** at colour boundaries. First 4 sweep blocks black (expected). **Red-tinted gradient** (software output is red/white only) printed ~1.2 mm black bars at one edge, then **red–black mixed** in the darker half. Colour gradient correspondingly messy. | **Needs calibration** — see **D-77** (red heat/coverage + plane registration); solid rows prove the flat path |
| 2026-11-08 | B (hardware) | Grayscale — 16 steps | Grayscale | owner printer, **red/black tape**, density 3 | Prints almost entirely **red**: usable ≈ **5–15**, 4 very faint/paper, 13–14 pure red, 15 red with slight black. Black objects show a faint red fringe. | **Paper mismatch** — grayscale mode on red/black stock is a red print; page colour must match stock |
| | B (hardware) | Red & black — calibration (density sweep) | Red & black | owner printer, red/black tape, densities 1–3 | **Isolated red ramp**: no black at any density; red fades to paper around the middle of the ramp. **Coverage ladder**: 75 % and 50 % bars visible, 25/12/6 % bars invisible/paper → **red coverage floor ≈50 %**. **Boundaries**: black intrudes ~1–1.5 mm into the following red bar; a red bar after paper starts with a ~0.5–1 mm black line inside it; the horizontal red stripe shows the same leading-edge black line. **Density**: 1 vs 2 vs 3 near-identical to the eye (75/50 bars only marginally deeper at 3). **Cross-check:** the same raster printed by the **official NIIMBOT desktop app is clean** at every colour boundary; niim.blue (same library) reproduces the bars → **library Mixed-row encoding bug (D-77)**, not the stock. The 75/50 vs 25/12/6 coverage floor also appears in the official app → physical (D-78). | **Library bug for edge bars (D-77)**; coverage floor is physical (D-78); density is not the lever |
| | B (hardware) | Red & black — calibration **48 mm control** | Red & black | | Harness calibration now defaults to 48 mm (567 px @300 dpi = printhead width; author says the trim artefact disappears). Repro PNG: `repro/red-black-calibration-48mm-300dpi.png`. Expect clean boundaries; the 50 mm raster/pattern is the repro. | |
| | B (hardware) | Grayscale — 50×160 long | Grayscale | | | |
| | B (hardware) | Red & black — flat / diffuse | Red & black | | | |

**Owner verdict:** *(grayscale 16-step: usable 4–14 at density 3; dynamic-range option to be added later — D-75. Red/black tape: solid rows correct; the ~0.5–1.5 mm bars at colour transitions are a **library Mixed-row bug** (official app clean) — D-77; red coverage floor ≈50 % is physical (official app shows it) — D-78; density 1–3 near-identical. Grayscale on red/black stock prints red (usable 5–15). Long-page row still pending.)*

When the rows are filled: only a clean long-page print can retire **D-73**; only
the red/black row can confirm the duotone calibration (the P9 constants are a
starting profile — see the P9 addendum) and the D-05 seam judgement. Do not close
debt from the preview.

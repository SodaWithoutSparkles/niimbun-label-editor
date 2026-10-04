# Handoff — Phase 5 (Objects + fonts + assets, M5)

**Run:** `agent/2026-09-29_label-editor-v1` · **Written:** 2026-10-04 · **Owner:** Coordinator
**Plan:** `plan.md` (P5 row, line 312) · **Prev handoff:** `HANDOFF-p4.md` (P4 DONE)
**For:** a NEW coordinator session — you drive P5 end to end. You do not re-plan P1–P4.

---

## 0. Read first (in order)

1. `plan.md` — **P5 row (line 312)**, Rendering pipeline (208–217), Data model (80–163,
   esp. `ImageRef`/`FontRef`/`AssetRef`/`ImageNode`/`QrNode`/`BarcodeNode`), decisions
   **6, 22, 23, 29, 30, 31, 36** (asset provenance/fingerprint/name), Editor section (243–252).
2. `HANDOFF-p4.md` — what P4 installed (the render pipeline P5 plugs into).
3. `agent/memory/print-transport.md` (P4 render-pipeline section), `agent/memory/testing.md`
   (real-canvas harness), `agent/memory/niimblue-reference.md` (**adopt**: QR/barcode 1px
   crispness, thumbnail recipe; **differentiators** to keep isolated).
4. `state.md` — P1–P4 done; P4 review record; carry items.
5. Reference clone (gitignored) for craft: `references/niimblue/src/fabric-object/qrcode.ts`,
   `src/fabric-object/barcode.ts`, `src/utils/barcode.ts`, `src/utils/canvas_utils.ts`.

## 1. Status: P4 DONE ✅ (2026-10-04)

- Commits `d1653b5`…`4bda894`; gate **APPROVE** (`review` + `experimental-review`); 618 tests.
- Hardware smoke **passed** on owner's B1_PRO (50×30 mm roll).
- **P5 = next.** No P5 code exists yet; the P4 pipeline is stable and should not be reworked.

## 2. P5 scope (frozen — from plan:312)

Deliver objects + resources so **text/image/QR/barcode place, render, and print**:

1. **Image objects** — resource store wiring (`src/data/resourceRepo.ts` already exists),
   the **resolution-cap rule** (plan Editor §246: `bitmap resolution = min(source, required
   by current viewport)`; for print, required = label px), render + print an `ImageNode`.
2. **QR + barcode objects** — templatable payloads (`QrNode.data` / `BarcodeNode.data` are
   `ContentSource`; static only in P5, execution is P6), render + print.
3. **Imported fonts** — upload/URL → **SHA-256 once** → IDB `resources`; `FontRef`
   `system|imported`; **missing → fallback + ⚠ badge**; badges `✓ imported / ⚠ system /
   ⚠ missing`.
4. **Asset name/alt + rename UI** — `ImageRef`/`FontRef` carry user-facing `name` + optional
   `alt`; rename never breaks references (names are document data, not keys).
5. **Barcode-lib spike** — **jsbarcode vs bwip-js** decides (decision 17). Record the pick.

**Exit criteria (plan):** text/image/QR/barcode place, render, print; font badges correct;
assets identifiable by name.

## 3. What already exists (do NOT rebuild)

- **Types** (`src/core/doc/types.ts`): `ImageNode{imageId}`, `QrNode{data}`, `BarcodeNode{data}`,
  `FontRef`, `ImageRef{imageId,name,alt?,source,widthPx,heightPx}`, `AssetRef` (4 provenances),
  `ContentSource{k static}`. `TextNode.fontFamily?` is free-text today.
- **Storage**: `src/data/resourceRepo.ts` (`resources` store = `{id, mediaType, bytes}`),
  `src/data/db.ts`, `src/data/labelRepo.ts`, `src/data/thumbRepo.ts`.
- **Render pipeline (P4)**: `src/editor/render/renderLabelPage.ts` is the shared path;
  `resolve.ts` **returns `undefined` for image/qr/barcode** (the P5 gap) and `konvaFactory.ts`
  has no image/QR/barcode cases. `rasterize.ts` applies black ink defaults (revisit for images).
- **Editor shell (P3)**: InsertRail has **Image/QR/Barcode entries disabled** (P5 enables them);
  inspector `inspectorModel.ts` has unwired stubs `imageId/resolution/fit`, `data`/`errorCorrection`/`size`
  (qr), `data`/`symbology`/`size` (barcode) — wire what P5 implements.
- **Test harness**: `src/test/canvasHarness.ts` (`installCanvasShim()`, real canvas in Vitest;
  Konva + Text render headlessly). `src/print/printLabel.ts` prints a doc end-to-end.

## 4. Locked decisions to honour (do not relitigate)

- **Asset provenance & identity**: all assets use one `AssetRef` (inline/remote/local/external)
  — decision 23; `name`+`alt` on every ref — 29; sha256 **once at import**, verify on load,
  never re-hash — 30; `external` is a legal provenance now — 31; `FontRef.source.imported` (not
  `embedded`; no duplicate `remote`) — 36.
- **Differentiator, keep isolated**: asset name/alt/fingerprint and the resolution cap are
  product features; keep the plain place→render→print path independent of them (guardrail).
- **No hostile sandboxing**, no template execution (that's P6) — QR/barcode use static `ContentSource`.
- **Integer hm discipline**; doc only stores ints. **`src/core/` stays React/Konva/DOM-free**
  (enforced by `src/core/headless.test.ts`).
- **Reuse plan:312**: image drag/drop/paste primitives exist in the (stripped) template — image
  drop/paste is listed as reusable; check `git log`/P3 strip before reaching for helpers.

## 5. Open decisions to resolve with the OWNER at P5 start (ask, don't guess)

These are genuine product/scope choices the plan leaves open:

1. **Barcode library**: `jsbarcode` vs `bwip-js` (spike). jsbarcode = smaller/stale; bwip-js =
   active, more symbologies, larger. Owner may already have a preference.
2. **Image provenance emitted by the editor's import UI**: the *format* supports all four
   `AssetRef` kinds; which does P5's import flow actually write? (Likely `local` for imported
   binaries — confirm; `inline`/`remote`/`external` are P8 export policy.)
3. **Resolution-cap rule specifics**: exact "required by current viewport" formula for the
   editor vs print (print = label backing px at dpi). Confirm the cap semantics.
4. **Font import UX**: system-font picker (descriptor) vs file upload — both? Where (inspector
   vs a settings/asset manager)?
5. **New dependencies** need explicit approval (`bun add`). Barcode lib is one.

## 6. Suggested workstreams (coordinator to refine)

| WS | Area | Files | Notes |
| -- | ---- | ----- | ----- |
| W1 | Image object: storage + resolve + Konva image + print | `src/core/doc`, `src/editor/render/*`, resource loading | needs an **async image decode** seam (raster/print are sync today — decide how images load before `rasterizeResolved`) |
| W2 | QR object (lib + render + print) | new `src/core/{qr,}` or `src/render`, `resolve.ts`, `konvaFactory.ts` | 1px crispness recipe |
| W3 | Barcode object (lib + render + print) | same pattern as W2 | depends on the lib spike |
| W4 | Fonts: import, sha256, store, badges, fallback | `src/data/resourceRepo.ts`, `src/core/doc`, font loader, inspector | |
| W5 | Asset name/alt/rename UI | inspector + `dialogService` | |
| W6 | Insert-rail enable + inspector wiring | `src/components/editor/{InsertRail,ObjectTab}.tsx`, `inspectorModel.ts` | |

**Sequencing:** spike (barcode lib) → W1/W2/W4 parallel (disjoint) → W3 (after spike) → W5/W6 →
review per area → fix → **headed check + owner hardware smoke** → commit per area.

## 7. Rules & commands

- Subagents must **not delegate** (depth 1). Missing info → terminal
  `needs-info. q: … . hint: … . next: … .`.
- Tests: `bun run test:run`; typecheck
  `node_modules/.bin/tsc.exe --noEmit`; build `…/bun.exe run build`. **Never `bunx`/`npx`/`bun test`.**
- Real-canvas tests via `src/test/canvasHarness.ts`; browser-only interactions (drag/drop/paste)
  verified **headed** with `ab` (dev server `bun run dev`, `?print=1` harness exists).
- Every product string through `t()` (decision 40); global `keydown`/`paste`/`drop` handlers
  bail on `dialog[open]`.
- **Reviewer routing:** `review` + `experimental-review` both available (owner, 2026-10-04);
  `review-fast` for narrow re-reviews. **Commit per area; ask the owner before each commit.**
- Owner runs all **hardware smoke**; advisory like P1/P4 — but P5's exit criteria include
  printing image/QR/barcode, so schedule one.

## 8. Carry-in items from P4 (non-blocking, don't lose)

- `printDirection` `right|bottom` encode unrotated like `top` (niimbluelib encoder is 2-valued);
  decide pre-rotate vs validate-reject before P8 import.
- Narrow-roll placement (feed/label offset + printhead-overflow warning) = **P7**.
- `applyPolicy` = one full-frame pass per distinct policy (bounded 4) — revisit before P7 batches.
- `rasterizeResolved` applies black ink defaults (no node style in v1) — revisit for images/fill/stroke.
- `ResolvedShape` renders image/qr/barcode blank — **this is exactly what P5 fills in.**

## 9. Gate (P5)

1. `bun run test:run` green · `tsc` clean · `bun run build` green.
2. Exit criteria demonstrated in the editor (place → render) and headed/print (image/QR/barcode print).
3. Review per area (`review` + `experimental-review`); fix ≤2; re-review APPROVE.
4. Update `state.md` + `phase5_action-plan.md`; escalate lessons to `agent/memory/*`.
5. Semantic commit(s) per area (ask owner first). Owner hardware smoke recorded.

**Start by writing `agent/2026-09-29_label-editor-v1/phase5_action-plan.md`, then ask the owner
the §5 decisions before dispatching W1.**

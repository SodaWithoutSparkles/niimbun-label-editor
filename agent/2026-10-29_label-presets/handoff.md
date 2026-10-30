# Handoff — label presets (fill-in labels)

- Date: 2026-10-31
- Run: `agent/2026-10-29_label-presets/`
- Baseline: `main` @ `4c9016b` (storage-safety wave 4 end)
- Head: `307d2f3` (P6b) + docs `3f82a2d`; the P7 docs commit follows this file
- **Gate: green** — `bun run test:run` → **188 files / 2772 tests passed**;
  `node node_modules/typescript/bin/tsc --noEmit` clean; `bun run build` green
  (tsc + vite, 2070 modules). No hardware print (owner deferred it on 2026-10-31).

Phase commits and their docs commits:

| Phase | Feature commit | Docs commit |
| --- | --- | --- |
| P1 | `9a2d61c` | `18fcee1` |
| P2 | `52fd3b2` | `b044be1` |
| P3 | `be60d5b` | `02f3289` |
| P4 | `d24e4ed` | `a9efb31` |
| P5 | `8670cf8` | `e2d40ed` |
| P6a | `f72c4fe` | `cb86eeb` |
| P6b | `307d2f3` | `3f82a2d` |

## Read these first

1. `agent/memory.md` → `memory/presets.md`, `memory/csv-templates.md`,
   `memory/app-shell.md`, `memory/storage-safety.md`.
2. `plan.md` in this run (decisions D1–D6 + the owner amendment splitting P6),
   then the phase action plans (`phase1`…`phase6b`) and `state.md` § "Phase
   notes" for the per-phase decisions.
3. `docs/user-guide/templates.md` — the author-facing contract for the four
   content kinds and the preset workflow.
4. This file.

## What shipped

| Area | Behaviour now | Commit |
| --- | --- | --- |
| Preset model | `meta.kind: 'label' \| 'preset'` is additive (doc `version` 1). Absent stays absent; unknown values are dropped with a repair. `LabelSummary.kind` is re-checked on read; the factory defaults new docs to `'label'`. Presets reuse the whole label storage path (thumbs, delete, autosave, bundle, orphan sweep). | `9a2d61c` |
| Field bindings | `ContentSource` gained `{ kind: 'field', name, fallback }` — its own namespace, never colliding with a CSV column or template. Strict validation; `docHasTemplateSources` treats it as pure data (non-executable), while unknown kinds stay fail-closed. A binding does not need a declaration to resolve. | `9a2d61c` |
| Resolution seam | `prepareResolvedContent({ fields })` resolves field sources by own-property name: non-empty value → fallback → `{empty}`. `TemplateContext.fields` is required (`{}` default), so templates read `ctx.fields.<id>` alongside `ctx.row` / `ctx.globals`. Values are never persisted. Preview and print share the one pass. | `52fd3b2` |
| Presets pane | `#/gallery/templates` now renders the **Label presets** pane across the five section vocabularies. Presets are filtered out of Recent (grid + sidebar); labels never appear in the pane. Cards share the label art/thumb backfill; delete reuses the store `deleteLabel` contract. | `be60d5b` |
| Authoring | File ▸ **Save as preset** copies the open label to a new preset (fresh id, `kind` explicit, thumb cleared, CSV/globals/resources preserved); the source is never converted and stays open. **JS** tab gains the **Field** kind (name + fallback); **MFP → Fields** declares ids with Default / Required / Hidden. New field names register on binding commit. | `d24e4ed`, `f72c4fe` |
| Fill + print | Clicking a preset card opens a modal with one input per field, a live colour preview and Print / Open in editor. Preview and `PrintDialog` share one `usePrintJob`, so preview ≡ print. Values are transient. "Open in editor" copies the preset into a normal label, bindings intact. The trust prompt is unchanged (first use of a template-bearing preset). | `8670cf8` |
| Declared fields | `data.fields` is additive. Duplicate ids are first-wins; invalid entries drop with repairs; ids/defaults stay untrimmed. Reserved `csv.row` is declared in the same undo entry as a CSV attach (and survives a detach). The fill form = visible declarations + bound-but-undeclared leftovers; hidden ids are reachable through **Add field**; required ids block Print and Open in editor while trimmed-empty. | `f72c4fe`, `307d2f3` |
| CSV row lookup | With `csv.row` declared and a readable attached CSV, the fill dialog offers a key-column select + key input; matching is exact after trimming, first duplicate wins. One-row table override feeds preview and print: matched row, stored sample row when no key is typed, or one all-empty fallback row on a miss (explicit status). A matched print is one label; `ctx.index` / `ctx.total` are `0` / `1`. | `307d2f3` |
| Docs + memory | `docs/user-guide/templates.md` gains the fourth kind, `ctx.fields.<id>`, the preset workflow, the CSV key lookup, the one-record caveat and the trust note. New `memory/presets.md` + index line; addenda to `csv-templates.md` and `app-shell.md`. | P7 docs commit (this pass) |

## Deviations from the plan

- **P6 was redesigned by the owner and split (2026-10-31).** The old "key column
  stored on the preset" sketch was dropped. The preset now **declares** its
  fields (`data.fields`), reserved ids exist (`csv.row` is the CSV row
  selector), and the fill form is driven by declarations **plus
  bound-but-undeclared ids**. P6a = model + reserved ids + Fields panel
  (`f72c4fe`); P6b = fill form + row lookup (`307d2f3`).
- **Empty field name relaxed (P4).** The validator accepts an empty/whitespace
  name so the half-authored state survives a reload. An empty name is
  explicitly unbindable and never listed in the fill form; missing/non-string
  names still fall back to static and unknown kinds stay fail-closed. The P1
  tests that pinned the rejection were updated.
- **One-row print is an explicit seam, not a prop swap.** `usePrintJob` gained
  `csv?: CsvJobSource` (`none`/`loading`/`ready`/`error`). Present wins: no repo
  read, status is the source's kind, record only for `ready`. The dialog builds
  the one-row table with `singleRowCsv`. This avoids the `PrintDialog.csv` /
  `prepareRow` desync the plan warned about, and makes `ctx.index`/`ctx.total`
  `0`/`1` for a one-record print.
- **Failed CSV read stays fail-closed.** An attached CSV that is still loading
  or failed reports `loading`/`error`; the dialog never falls back to the
  document's full table and hides the row controls, and the print dialog's P12
  gate disables printing. Only "nothing attached" (`none`) is the normal
  one-page path.
- **No hardware print yet.** The P5 exit criterion's owner print and P6b's
  real-CSV verification were deferred by the owner (2026-10-31).
- **Presets are not edited in place** (by design, D3): revise one via
  **Open in editor** → edit the normal copy → **Save as preset** again.

## Known nits

- After an external close mid-copy, the fill dialog's `opening` flag stays true
  until the next open resets it. It is invisible while closed and was approved
  as a nit; dismissal is blocked mid-copy, so no action is lost.
- `be60d5b`'s commit message says "Logo/coming-soon" where it meant
  "Nav/coming-soon". History is not rewritten; the content is correct.

## Follow-ups

- **Owner, hardware:** print one filled preset, including a key-matched CSV row,
  on real stock. This closes the P5/P6b verification gaps and exercises the
  one-row seam on hardware.
- **Next feature run: dual-color (red/black).** Per
  `agent/memory/dual-color.md`, it is the next feature after this run; the
  research, seam map and one-print verification strategy are parked there.
- P7's own commit: `docs(presets): user guide, memory and run handoff`.

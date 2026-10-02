# Phase 2 Action Plan — Document model + storage + gallery (M1+M2)

**Run:** `agent/2026-09-29_label-editor-v1` · **Owner:** Coordinator · **Plan ref:** `plan.md` P2
**Status:** READY (written 2026-10-03 after the niim.blue reference review)
**Prereq:** P1 done (`380be10`, `f2a2a69`, `24f565f`). Read this whole file before starting.

---

## 0. Orient first (10 min, do not skip)

You are starting cold. Read, in order:

1. This file.
2. `agent/2026-09-29_label-editor-v1/state.md` — what P1 shipped and its carry-overs.
3. `agent/memory.md` → then `agent/memory/print-transport.md` and `agent/memory/niimblue-reference.md`.
4. Plan sections: **Data model**, **Storage**, **Decisions log** (esp. 5, 10, 20, 23, 26–31, 34–38, 42), **P2 row**.
5. Existing patterns you must reuse, not reinvent: `src/store/preferenceValidation.ts`, `src/store/legacyStorage.ts`, `src/utils/compress.ts`, `src/utils/saveProject.ts`, `src/components/common/dialogs`, `src/components/settings/` form kit.

**The reference clone is your friend:** `references/niimblue/` (gitignored). For *craft details only* (thumbnail recipe, preset card UI, persistence migration shape) consult `references/niimblue/src/utils/persistence.ts`, `file_utils.ts`, `defaults.ts`, `LabelPresetsBrowser.svelte`. **Do not copy its data model** — see §2.

---

## 1. Scope (frozen)

Deliver a label that can be created, persisted, and reopened — nothing renders yet (that is P4).

1. **`src/core/doc/`** — LabelDoc v1 types + validation + factory + version/migration seam.
2. **IDB layer** (`src/data/`) — `labeleditor.v1` with `labels`, `resources`, `csvs`, `thumbs` stores. **Trust store is deferred** (P6) — do not build it now.
3. **`.lbl.json.gz` save/load** — pure serialize/parse functions reusing `compress.ts`; FS-Access/download patterns from `saveProject.ts`.
4. **Gallery UI** — grid of pseudo-cards (render-only; never executes templates; never fetches), create dialog with preset picker incl. `ftagSpare-25x78`, custom regions editor (minimal), roll/dpi mismatch warning is **P3** (adapter already exposes the data; do not build UI here).
5. **Create → persist in IDB → reopen after reload** must work. That is the exit criterion.

**Out of scope:** rendering/Konva, editor canvas, node editing, import/export policy (P8), templates/trust/CSV parse (P6), asset import UI (P5 — but the *types and storage* for assets land now).

---

## 2. Data model — decisions you must implement exactly

Copy the type block from `plan.md` §Data model **verbatim** into `src/core/doc/types.ts`. It is the contract; do not "improve" it. Highlights and non-obvious points:

- **`hm` is integer hundredths of a mm.** Import the `hm` type from `src/core/hm.ts` (P1). **Never store floats in the doc.** `rotDeg` and `scaleX/scaleY` are the only non-hm numbers allowed in a transform.
- **`version: 1`** is a literal. This is a fresh schema, not the chat's v2.
- **`AssetRef` has 4 provenances from day one** (`inline`/`remote`/`local`/`external`). This is a **deliberate differentiator** (plan decision 42) — do not trim it to `inline` only, even though niim.blue inlines everything. Validate all four; use `local` for anything the user imports into our IDB.
- **`FontRef.source` is `system | imported`** — there is no `embedded`/`remote` variant (decision 36).
- **`regions` is consumed only as `union(regions)`** (decision 25). Do not add roles/ids/zone labels. The F-tag's `flag`/`tail`/`spare` are comment names, not fields.
- **`meta.thumb` is raster-only** and optional: validate mime ∈ {png,jpeg,webp}, longest side ≤ 512, decoded bytes ≤ 64 KB, else **reject the thumb, keep the doc**. It is cosmetic and may be stale.
- **`label.dpi`** clamp 100–1200 (rounded int) on validation. Common 203/300.
- **Derived semantics are never stored** (`effectiveVisible`, `effectiveLocked`, `effectiveTransform`, children-from-`parentId`). Provide pure helper functions in `src/core/doc/derive.ts` + tests; do **not** cache them on nodes.
- **`data.globals` / template fields exist as type slots now** even though the template engine is P6 (scaffolding rule, decision 22/42).

### F-tag preset (must reproduce exactly, backing 2500×7800 hm)
```
flag : roundedRect x1400 y0 w1100 h3800 r200
tail : rect        x1900 y3800 w600 h4000
spare: polygon     [[0,0],[1300,0],[1300,3800],[1800,3800],[1800,7800],[0,7800]]
```

---

## 3. Validation — use what's there, do NOT add a validation lib

Owner decision (2026-10-03): **no new dependency** (the plan parked zod for P2; the owner resolved it to "use existing patterns"). Follow the repo's hand-rolled precedent:

- `src/store/preferenceValidation.ts` — narrow per-field validators returning a repaired value, plus `pickPersistedKeys`.
- `src/store/legacyStorage.ts` — the migrate-then-delete-old-key shape.

Implement `src/core/doc/validate.ts` with small pure validators (`isHm`, `isRegion`, `isAssetRef`, `isNode`, `isLabelDoc`) that:
- **repair** what is safely repairable (clamp dpi, coerce to int hm, default missing optional fields),
- **reject** structurally wrong documents with a typed result, e.g. `{ ok: true, doc } | { ok: false, errors: string[] }`,
- **never throw** from a parse path (the caller decides), and **never silently reset to a blank doc** — that is niim.blue's anti-pattern (`persistence.ts` `writablePersisted`).
- Migration seam: `migrate(raw: unknown): LabelDoc` keyed on `raw.version`, with a single `1 → 1` identity today, so P8's import can add cases without reshaping callers.

**Test the validator hard** — corrupt docs, missing fields, float hm, out-of-range dpi, bad thumb, unknown version. This is the single highest-value test surface in P2.

---

## 4. IDB layer

`idb` is not yet installed → **`bun add idb@8.0.3`** (exact pin; never npm). DB name `labeleditor.v1`.

Stores (plan §Storage):
| store | key | value |
| --- | --- | --- |
| `labels` | `labelId` | `{ meta, docGz: Uint8Array }` |
| `resources` | `resourceId` | font binaries, images (bytes + mediaType) |
| `csvs` | `id` | `{ id, name, columns[], rows: string[][] }` |
| `thumbs` | `labelId` | PNG/JPEG blob |

**Trust store: NOT in P2.** (It has no consumer until P6; building it now is dead code.) Keep the `labeleditor.v1` DB version bump friendly so P6 can add `trust` without a destructive upgrade.

Rules:
- **`labels` stores the gzipped doc.** Reuse `compress`/`decompress` from `src/utils/compress.ts`. (Real browsers accept the raw `ArrayBuffer` write chunk; the Vitest runner does NOT for `DecompressionStream` — see `memory/testing.md` and `saveFileRoundTrip.test.ts`. Follow that file's adaptation pattern in tests; do not change app code.)
- **Per-record writes (`put`), never delete-all-then-rewrite.** niim.blue's destructive full rewrite is the anti-pattern.
- **Per-record error collection** on bulk operations: return `{ ok, errors }` like niim.blue's `saveLabels` `{zodErrors, otherErrors}` — surface which label failed, don't blank the gallery.
- **Migration on first read, then delete the old key** (localStorage → IDB transition; copy the shape from `legacyStorage.ts` / reference `persistence.ts`).
- Autosave moves to IDB. The template's localStorage autosave is write-only and unreadable — do not preserve it.
- Wrap IDB in a tiny repo module (`src/data/labelRepo.ts` etc.) with a **fake/in-memory adapter for tests** (happy-dom's IDB support is unreliable; test the repo logic against an injected fake, mirroring P1's injectable `createClient`).

**`.lbl.json.gz` functions** (`src/core/doc/serialize.ts`): pure `serializeDoc(doc): Promise<ArrayBuffer>` / `parseDoc(buffer|string): Promise<ValidationResult>`; keep FS-Access/download in a thin UI-side helper reusing `saveProject.ts` patterns. Format = gzip JSON document (plain ints, no typed arrays).

---

## 5. Gallery + create dialog (UI)

- **Gallery:** grid of cards. Card art resolution order (decision 37): local IDB thumb → `meta.thumb` → generated placeholder (backing outline + region-union silhouette + name). **Never execute templates, never fetch.** A pseudo-card is fine for P2 (a real render is P4).
- **Create dialog:** use the shared `Modal` + `dialogService` and the form kit (`Input`/`Select`/`Toggle`/`SettingRow`). Preset picker incl. `ftagSpare-25x78`; custom size + a **minimal** regions editor (list of regions with numeric fields; polygon maybe read-only/JSON for now — do not gold-plate). Every string through `t()` (decision 40), dynamic keys via the literal-map pattern.
- **Connection chip** top-right (gallery + editor) — status only; it consumes `PrinterTransport.onStatus` (P1). For P2 a `MockTransport`/disconnected state is enough.
- **Roll/dpi mismatch warning is P3.** The adapter already reports `rollWidthHm/rollHeightHm/dpi`; do not build the warning UI now.
- Use `cn()`, respect `<React.StrictMode>` idempotency, and the global-listener guard on `dialog[open]` (see `memory.md`).

---

## 6. Lessons from P1 (do not relearn these)

- **Run the real gate:** `bun run test:run` (Vitest — NEVER `bun test`), `bun x tsc --noEmit`, `bun run build`. All three, before claiming done.
- **`tsc` is strict:** `verbatimModuleSyntax` (type-only imports need `import type`), `noUnusedLocals/Parameters`, `erasableSyntaxOnly` (no TS enums/namespaces/param-properties). Tests are typechecked by the build.
- **Review caught real bugs that tests missed** — twice (a hardware-breaking option merge, then a detached-`this` regression). Treat review as a gate, not a formality. `review` is region-blocked → use `review-alt`; it has **no shell**, so paste tsc/test/build evidence into the review prompt.
- **Write regression tests that FAIL against the bug** — for a critical fix, temporarily revert and confirm the test goes red (P1 did this for the `connect` receiver bug). Say so in the receipt.
- **Constructor/injection seams beat mocking modules.** P1's `createClient` seam made the adapter testable. Do the same for IDB (`createRepo`/adapter).
- **`sed` is forbidden** (dangerous, won't auto-approve). Use `read`/`grep`; for line ranges `head -n N file | tail -m`.
- **Package manager is `bun.exe`** at `bun` (WSL repo on drvfs). `bun add <pkg>@<exact>`.
- **Hardware harness** exists at `?hardware=1` (dev-only overlay). Not needed in P2, but don't break it (it imports `src/print`, not `src/data`).

---

## 7. Things to look out for (gotchas)

- **`hm` integer discipline.** Any `+`/`*` on hm that can yield a float must round. Add a test that a doc produced by the factory/validators contains only integers in geometry fields (deep scan) — cheap invariant guard, mirroring P1's headless guard.
- **`union(regions)` is data, not logic yet.** P2 only stores/validates regions. Provide `regionUnionBounds(regions)` as a pure helper for the thumbnail silhouette; do NOT implement raster clipping (P4).
- **`meta.id` policy (decision 39)** lands in P2 for *create*: mint a fresh id. Import/duplicate re-assignment is P8, but write the `newLabelId()` helper + tests now so P8 can't get it wrong.
- **Dates are epoch seconds**, never ms (decision 20/26). `ctx.now` (ms) is a P6 template detail — unrelated; don't conflate.
- **Thumb validation is a trust boundary:** `meta.thumb` comes from a document. Raster-only, size-capped, reject-don't-render-as-HTML. Test the rejection path.
- **IDB in tests:** happy-dom's `indexedDB` is incomplete. Use `fake-indexeddb` **only if** you cannot cleanly inject a fake repo; prefer the injection seam (no new dep). If you do add a dep, it goes in devDependencies and must be justified in the receipt.
- **`structuredClone`** is available in happy-dom; prefer it over JSON round-trips for deep copies (faster, preserves typed arrays).
- **Don't let AssetRef/provenances balloon P2.** Store the union + validators; the *import/export policy* (which provenance is emitted, zip handover) is P8. `local` is the only provenance P2 actually writes.
- **Do not build the trust store, template engine, or globals prefetch** — those are P6. Type slots only.

---

## 8. Work plan (parallelizable)

Run independent streams in **background subagents** (see `memory.md` → Agent workflow: `subagent` with `background: true`, returns a `sessionID`, wakes you on completion). Suggested split:

| Stream | Deliverable | Depends on |
| --- | --- | --- |
| A | `src/core/doc/{types,validate,derive,factory,serialize}.ts` + tests (incl. `newLabelId`, F-tag preset, integer-scan, thumb rejection) | — |
| B | `bun add idb` + `src/data/{db,labelRepo,resourceRepo,csvRepo,thumbRepo}.ts` + injected-fake tests + localStorage→IDB migration | A's types |
| C | Gallery UI + create dialog + connection chip (uses B's repo, shared Modal/form kit, `t()`) | A, B |

A first, then B and C can overlap (C needs B's repo interface — define it early). Keep streams non-overlapping by file.

**Files expected (adjust as needed):**
```
src/core/doc/types.ts        src/core/doc/validate.ts     src/core/doc/derive.ts
src/core/doc/factory.ts      src/core/doc/serialize.ts    src/core/doc/*.test.ts
src/data/db.ts               src/data/labelRepo.ts        src/data/resourceRepo.ts
src/data/csvRepo.ts          src/data/thumbRepo.ts        src/data/*.test.ts
src/components/gallery/…     src/components/labels/CreateLabelDialog.tsx
src/components/common/ConnectionChip.tsx
src/store/slices/docSlice.ts (or a dedicated store — decide and justify)
```

---

## 9. Gate (all must pass)

1. `bun run test:run` green; `bun x tsc --noEmit` clean; `bun run build` green.
2. **Exit criterion demonstrated:** create an F-tag label → it persists in IDB → **reload the page → it is still there and opens**. Show the evidence (test or a browser check via `ab`; browsers headed, never headless).
3. Review: `review-alt` (primary; region-blocked fallback) + optionally `experimental-review` as a second opinion. Paste shell evidence. Address all `[must-fix]`; ≤2 fix rounds, then escalate to the user.
4. Update `state.md` + this action plan; escalate project-relevant lessons to `agent/memory.md` / `agent/memory/*.md` (e.g. a `memory/storage-idb.md` if the IDB patterns are worth keeping).
5. Semantic commit (`feat(doc): …` / `feat(storage): …`; split by stream if it reads better).

## 10. Report to the user (phase receipt)

```
## Phase 2 — {summary}
- done: [what shipped]
- tests: [result]
- reviewed: [by whom, verdict]
- committed: [hash / not committed]
- next: [P3 ready | escalation: …]
```
Also state explicitly which plan decisions you implemented (§2 list) and any deviation, with justification.

---

## Appendix — plan decisions most relevant to P2

| # | Decision | P2 impact |
| --- | --- | --- |
| 5 | Flat `nodes[]` + `parentId`; groups are nodes | types + derive only |
| 10 | Doc `version: 1` (fresh schema) | literal + migration seam |
| 20/26 | `.lbl.json.gz`; dates = epoch seconds | serialize + meta |
| 22/42 | Keep differentiator seams; don't trim to reference | AssetRef ×4, regions, global slots stay |
| 23 | One `AssetRef`, 4 provenances | types + validators |
| 25 | `regions` = union clip only, no roles | types + bounds helper |
| 27 | Validation lib: use repo patterns (no new dep) | `validate.ts` hand-rolled |
| 28/29/30/31 | CSV/asset naming, fingerprints, external | types now, policy P8 |
| 34/35 | dpi number; clamp 100–1200; mismatch warning (UI deferred P3) | validators |
| 37/38 | Gallery art tiers; `meta.thumb` raster-only | gallery + thumb validators |
| 39 | Import/duplicate mint new id; trust explicit | `newLabelId()` now, import policy P8 |

# Label presets — run plan

- Date: 2026-10-29
- Baseline: `main` @ `4c9016b` (storage-safety run, wave 4 end; tree clean)
- Scope owner: user
- Status: **PLANNED — hand off to coordinator**

## Why

Owner definition (2026-10-09, round-2-fixes plan): *"label preset is a
user-designed pre-designed label, with just data missing. Then the user can use
a preset, fill in specific data, and print."* The gallery nav item was renamed
"Label presets" then; the section is still a placeholder.

Owner use case (2026-10-29): print a new-price label for product id 23 —
pull the product's row from an attached CSV by key, type the new price in USD,
show both prices in USD and JPY using an exchange rate fetched as a global.
This run makes that workflow real.

## Non-goals (explicitly out of scope)

- **Red/black color space** — next feature run after this one; research parked
  in [`agent/memory/dual-color.md`](../memory/dual-color.md). Do not touch the
  quantize/encode pipeline here.
- **CSV row lookup by key** — owner-approved as a *conditional last phase*
  (P6); slide to a follow-up run if the base lands dirty.
- Preset marketplace / hosted sharing. Bundle export/import already hands a
  preset between machines; nothing more.
- `{{ }}` interpolation syntax. Bindings stay structural JSON
  (`ContentSource` kinds) — see D2.
- Small backlog items (D-72 warning producer, PNG export, `promptText`
  deletion) — separate runs.
- No new object types, no new doc `version` bump (schema changes additive).

## Design — decisions (owner, 2026-10-29)

| # | Decision |
| --- | --- |
| D1 | **Preset = LabelDoc with `meta.kind: 'preset'`** (absent / `'label'` = normal label). Additive optional field; doc `version` stays 1. One storage path: thumbs, delete, autosave, bundle, orphan sweep all reuse the label machinery. The gallery `templates` section filters on the flag. |
| D2 | **Field bindings are a first-class `ContentSource` kind**: `{ kind: 'field'; name: string; fallback: string }`. Namespaced by kind — `{kind:'field', name:'price'}` can never collide with `{kind:'csv', column:'price'}`. NO synthetic-CSV trickery (owner explicitly raised the collision risk). JS templates read fields via the row context (e.g. `ctx.fields.price`) and can compose fields + CSV row + globals in one expression. |
| D3 | **Fill dialog actions: Print + "Open in editor."** Open-in-editor creates a copy as a normal label (fresh id, `kind` cleared, bindings intact, unfilled — sample-row preview as today). No "save filled copy" (baking values into static content is a non-goal; the owner can re-print from the dialog). |
| D4 | **Row-by-key lookup = P6, conditional** on P1–P5 landing clean (owner 2026-10-29). |
| D5 | **Commit per phase**, semantic, only after review green. Public repo: **never write an absolute home/machine path into any file** — repo-relative or tool name only (see `agent/memory.md` "Essentials"). |
| D6 | **UI is owner-designed** (memory `ui-design-workflow.md`): screenshot/mspaint spec = truth; agents never redesign. P3/P4/P5 UI surfaces need owner specs before their UI sub-phases. Structure/wiring phases can land first with minimal placeholder-free UI. |

## Phase 0 seam map (verified 2026-10-29, receipts into `src/`)

Read this before writing any phase action plan. Facts:

- **Section activation touches 5 parallel vocabularies with no registry**:
  `src/store/slices/viewSlice.ts:31` (`GallerySection` union — `'templates'`
  already a member), `src/utils/urlHash.ts:31` (`GALLERY_SECTIONS`; `#/gallery/templates`
  already parses/emits), `src/components/layout/NavSidebar.tsx:10-26,109-119`
  (order/icon/label + the only `nav.comingSoon` branch),
  `src/components/layout/MainLayout.tsx:39-47` (inline ternary chain — no
  `templates` branch; **the section currently renders the ordinary label grid,
  NOT a coming-soom screen**), `src/i18n/locales/en.json:323,327`
  (`nav.templates` = "Label presets", `nav.comingSoon`). Tests pin the URL and
  sync layers: `urlHash.test.ts:34,89`, `useUrlSync.test.ts:396`.
- **Validation strips unknown meta fields**: `src/core/doc/validate.ts:1078-1087`
  (`isLabelDoc` rebuilds `meta` as a literal). A new field must be added to
  `src/core/doc/types.ts:298-314`, that literal, and the summary path
  (`src/data/labelRepo.ts:25-33` — `LabelSummary` carries no kind today).
  `migrate` (`validate.ts:1113`) is identity; keep it so.
- **Bindings are structural**: `src/core/doc/types.ts:202-205`
  `ContentSource = {kind:'static',value} | {kind:'csv',column,fallback} | {kind:'template',code,fallback}`.
  Authoring UI: `src/components/editor/JsTab.tsx:162-247` (kind select, column
  select/free-text, fallback, code textarea). Resolution:
  `src/editor/render/prepareContent.ts:87-94` (`csvCell` binds by
  `columns.indexOf(column)`), `:80-84` (`finalize`: raw → `fallback` →
  `{empty}` literal, `src/editor/render/resolve.ts:65`).
- **`docHasTemplateSources`** (`src/core/trust.ts:151-170`) counts text/QR/
  barcode/code carriers and treats malformed/unknown source kinds as
  executable (fail closed). A `'field'` kind is pure data — it must be
  explicitly non-executable there, and the field-kind validator must be strict
  so unknown kinds stay fail-closed.
- **Row context**: `src/core/doc/rowContext.ts:17-37,59-94` builds
  `{index,total,row,rowCount,now,label,globals,fmt?,seeds}` for JS templates.
  Fields need a home here (e.g. `fields`).
- **The data layer already accepts a synthetic row**:
  `prepareResolvedContent` takes `csv: CsvRecord | null` and reads only
  `columns`/`rows` (`prepareContent.ts:52-63,107-116`); `CsvRecord` is a plain
  `{id,name,columns,rows}` (`src/data/csvRepo.ts:12-17`). The gap is
  **injection**: `src/components/editor/useSampleRow.ts:155-166` and
  `src/components/print/usePrintJob.ts:179-228,295-299` resolve only the doc's
  *stored* attachment.
- **Print can print one record today**: `src/print/printLabel.ts:175-262`
  `buildCsvPrintJob` (`rows = csv?.rows.length ?? 1`), per page
  `deps.prepareRow(rowIndex)`. BUT the dialog's `csv` prop and its `prepareRow`
  are independent inputs (`PrintDialog.tsx:207-230` vs `usePrintJob.ts:230-231`)
  — substituting one without the other desyncs displayed rows from resolved
  content. The field-values seam must keep both consistent.
- **Factory vs store gap**: `src/core/doc/factory.ts:222-259` `createLabelDoc`
  already accepts `nodes` (clones + rounds, `:214,256`), but
  `src/store/storeTypes.ts:29-39` `CreateLabelSpec` has no `nodes` field, so
  the UI cannot create a document with content. No duplicate action exists
  anywhere (`FileMenu.tsx:73-107`, `LabelCard.tsx:76-126`, store actions
  `storeTypes.ts:267-272`); the only fresh-id copy path is export→import
  (`src/data/bundle.ts:393-470`, fresh id at `:426`).
- **Dead "Quick print" button**: `LabelCard.tsx:105-114` renders
  `gallery.quickPrintUnavailable` hard-disabled — natural fill-and-print entry
  for preset cards.
- **Trust**: keyed per doc id (`src/core/trust.ts:80-87`; import mints fresh
  ids so trust never carries, `bundle.ts:424-426`). Fail-closed: only
  `always` builds a JS engine (`useSampleRow.ts:212-214`,
  `usePrintJob.ts:286-291`). A preset with JS templates prompts once at first
  use; the same machinery applies unchanged.
- **Globals** (`GlobalSpec`, expiry, prefetch-once-per-job) already exist and
  satisfy the exchange-rate example — no new work.
- **niim.blue preset UX to adopt** (memory `niimblue-reference.md` §Adopt):
  thumbnail card grid, title-or-size label, inline delete confirm, plus our
  region-union silhouette thumbs (already produced by
  `renderDocPreview`/`useThumbBackfill`).
- **Catalogue shell to copy for the section pane**:
  `src/components/paper/useCatalogue.ts:21-53` + `CatalogueLayout.tsx:24-110`.

## Phases

> **Owner amendment (2026-10-31):** P6 was redesigned by the owner and split in
> two. The preset document now **declares its fields**
> (`data.fields: { id, default?, required?, hidden? }[]`, additive); reserved ids
> exist, and `csv.row` is the CSV row selector. The fill form is driven by
> declarations **plus bound-but-undeclared ids**; defaults prefill, required is
> enforced, hidden ids are reachable via "add field", and the row selector does
> key lookup (column + typed key) with a single matched record printed.
> The old "key column stored on the preset" sketch is dropped.
> **P6a** = model + reserved ids + Fields panel (landed, `f72c4fe`);
> **P6b** = fill form + row lookup.

Each phase = one coordinator cycle: `phase{N}_action-plan.md` → implement →
review (`review` primary, `review-fast` for mechanical) → fix (≤2 rounds) →
semantic commit. No week estimates.

| # | Phase | Scope | Exit criteria |
| --- | --- | --- | --- |
| P1 | Doc model: preset flag + field bindings | `meta.kind` additive field (types, `isLabelDoc` meta literal, `LabelSummary` + repo read path, factory default `'label'`); `ContentSource` gains `{kind:'field', name, fallback}` (types, strict validation, `docHasTemplateSources` non-executable); `CreateLabelSpec` gains `nodes` passthrough. | Round-trip test: preset doc saves/loads with kind + field bindings intact; old docs (no kind) validate as labels; field-kind source fails closed if malformed. |
| P2 | Resolution seam: field values end-to-end | `prepareResolvedContent`/`buildRowContext` accept field values (`fields: Record<string,string>`; JS ctx gains `fields`); `resolve(doc,{overrides})` unchanged; `useSampleRow` can run with an injected values map (no stored-attachment requirement); print `prepareRow` seam carries field values through `buildCsvPrintJob`. Preview≡print still one path. | Unit: field binding resolves injected value → fallback → `{empty}`; JS template reads `ctx.fields` + `ctx.row` + `ctx.globals` in one expression; print raster of a filled field matches editor raster (existing golden style). |
| P3 | Preset section + gallery surfaces | Activate `templates` section across the 5 vocabularies + tests; `MainLayout` branch renders a preset pane (catalogue-shell based); gallery partitions: presets section shows only `kind:'preset'`, Recent hides them; preset cards (thumb, name, delete reusing the label-delete contract); dead Quick print button becomes the preset card action (disabled state removed). i18n keys. | `#/gallery/templates` shows presets; a label never appears there; delete works with the existing confirm + autosave-flush contract. |
| P4 | Authoring: save as preset + field bindings UI | File menu "Save as preset" (copies doc under fresh id, `kind:'preset'`, or converts in place — pick in action plan with owner); JsTab kind select gains "Field" (name + fallback inputs); duplicate/"Open in editor" copy path (fresh id, `kind` cleared, nodes cloned via factory). **Owner UI spec first** (D6). | Author can convert an existing label into a preset, add field bindings to text/QR objects, see fallback placeholder in the editor preview. |
| P5 | Fill + print flow | Fill dialog: form auto-derived from distinct field names across nodes (one input per name; fallback = placeholder text); live preview via the P2 seam (sample-row pass with injected values); Print = one-record job through the existing dialog/runner with field values consistent end-to-end (mind the csv-prop/prepareRow desync trap); "Open in editor" per D3; trust prompt on first use of a template-bearing preset. **Owner UI spec first** (D6). | Owner workflow: click preset → type values → see live preview → print; one hardware print of a filled preset label. |
| P6 | **Conditional** — CSV row lookup by key | Only if P1–P5 landed clean (D4). Key-column designation on the preset (which CSV column is the key), fill-dialog input selects/enters a key, matched row feeds the row context; miss = explicit empty/fallback state, never a silent wrong row. | Owner's product-id-23 example works end-to-end against a real CSV. |
| P7 | Verify + docs + escalate | Full gate: `bun run test`, `bun run build`; user-guide update (`docs/user-guide/templates.md` gains field bindings + a presets section); memory escalation (new `agent/memory/presets.md` or extend `memory/csv-templates.md` + `memory/app-shell.md`; keep index short). | Gate green; docs + memory landed; handoff written. |

Phase sequencing rules: P1 → P2 strictly ordered (P2 consumes P1 types).
P3 depends on P1 only (summary flag) and can run parallel to P2 if the
coordinator can keep `en.json` single-writer per phase. P4/P5 need owner UI
specs — request them when P3 lands, not before.

## Test plan (must exist before a phase is called done)

- P1: validator round-trips (preset flag, field source, unknown-kind source
  dropped/fail-closed); `LabelSummary` carries kind; factory defaults.
- P2: field resolve precedence; `ctx.fields` in JS template; preview≡print
  golden on a filled preset; field values never persisted into the doc.
- P3: URL parse/emit; section routing; partition correctness both ways;
  delete flows through the existing contract tests.
- P4: convert/creates fresh ids (never overwrites the source label);
  field-binding authoring writes valid `ContentSource`.
- P5: dialog DOM tests (form derived from nodes, dedupe by name, fallback
  placeholder); print job built from injected values; trust prompt path.
- P6 (if it runs): key match/miss semantics; no silent wrong-row.

## Risks

| Risk | Mitigation |
| --- | --- |
| 5 parallel section vocabularies drift (no registry) | P3 adds/updates the pinning tests in every layer; no registry refactor this run (YAGNI — note in tech-debt if it bites again) |
| Fill form vs `{empty}` semantics confuse (empty string is a legitimate value) | Form treats empty input as "use fallback" only when the user clears it; preview shows the literal result — what you see prints |
| Dialog `csv` prop / `prepareRow` desync (two independent inputs) | P5 wires both from one source of truth; test pins content-vs-display consistency |
| Preset with JS templates prompts on every fresh id (copies/imports) | Existing trust UX handles it (allow-always per id); document in user guide; do not invent new trust semantics |
| Export/import of presets loses nothing | P7 verifies bundle carries `meta.kind` and field sources (contract: import mints fresh ids, trust never carries) |
| Scope creep into red/black or row-key | Non-goals enforced; P6 explicitly conditional |

## ENV BRIEF (paste into every delegation)

- Repo: `niimbun-label-editor` (WSL on drvfs; run from the repo root; never
  write the checkout path into a file — public repo).
- Stack: React 19, TypeScript, zustand (flat slices), Tailwind v4, Konva,
  Vitest + happy-dom.
- Package manager: **bun**. Tests: `bun run test` (NEVER `bun test`). Build:
  `bun run build` (`tsc && vite build`). Typecheck: `tsc --noEmit` via
  `node node_modules/typescript/bin/tsc`. Repo on drvfs is slow — prefer
  `tsc` over full builds during phases.
- i18n: all product strings via typed `t()` keys; **one `en.json` writer per
  phase**; edit `en.json` directly in-phase.
- Global window listeners must bail when `document.querySelector('dialog[open]')`.
- `<React.StrictMode>` active — effects fire twice; dialog/portal code idempotent.
- Reviewer routing: `review` primary, `review-alt` fallback (region-block),
  `review-fast` for mechanical re-reviews.
- **Never** `git stash`, destructive git, or push. Semantic commit per phase
  only after review green.
- Delegation depth 1: subagents must not delegate. Missing info → terminal
  `needs-info. q: … . hint: … . next: …` line.
- Memory: read `agent/memory.md` first; relevant areas here:
  `memory/csv-templates.md` (binding/trust machinery),
  `memory/app-shell.md` (gallery/url/thumbs),
  `memory/objects-assets.md` (object model),
  `memory/storage-safety.md` (delete/autosave contracts),
  `memory/code-organization.md` (layer contract).

## Commit strategy

Semantic commits, one per phase, only after review green. Sketch:

1. `feat(doc): mark documents as presets and add field content bindings`
2. `feat(render): resolve field bindings through preview and print`
3. `feat(gallery): activate the label-presets section`
4. `feat(editor): author presets and field bindings`
5. `feat(print): fill-in dialog for presets`
6. `feat(presets): csv row lookup by key` (only if P6 runs)
7. `docs(presets): user guide and memory`

## Handoff

Switch to the **coordinator** agent (Tab). Start by reading this plan +
`agent/memory.md`, then write `phase1_action-plan.md`. Request owner UI specs
for P4/P5 when P3 lands. Escalate to Build (CTO) only for design changes that
contradict D1–D6.

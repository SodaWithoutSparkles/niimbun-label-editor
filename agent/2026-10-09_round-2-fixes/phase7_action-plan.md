# Phase 7 action plan — Shell & printer surfaces

Reads with [`plan.md`](plan.md) §P7, [`state.md`](state.md), [`handoff-p7.md`](handoff-p7.md)
(all P7 research + owner decisions), and `../memory/niimblue-reference.md`.
HEAD at start: `525ed11`. Base: `5c756e8`. Branch `main`.

## Owner decisions locked for this phase

1. **Relocated auto-save status is READ-ONLY** in `EditorStatusBar` (File menu checkbox is the only
   toggle). No `toggleAutoSave` in the editor bar.
2. **Two commits**: A = shell cleanup, B = printer popover.
3. **`BottomBar` is DELETED** (owner 2026-10-12). Rationale: it only mounts in the gallery
   (`MainLayout.tsx:41`) and its sole surviving control (back-to-gallery, `:182-191`) is gated
   `view === 'editor'`, so it can never render — after stripping the leftovers it is an empty strip.
   The handoff's "the back button must stay" premise was factually wrong.
4. **"Back to gallery" belongs in the File menu**, not in a status bar. → File ▸ Home.
   (`nav.backToGallery` / `nav.backToGalleryTitle` become dead and are deleted.)
5. `EditorStatusBar` is the *editor* strip (zoom / DPI / sample-row) and is the bar that holds the
   F1 chip; `BottomBar` was the *gallery* strip. They are different components.
6. P7 branding = app rename only (`index.html:8` title + `about.message`).
   `settings.shortcuts.drawingModifiers` is NOT touched.
7. `en.json` is edited directly this phase, deletions included (plan.md #8 superseded).

## Nav rename — value decided

`nav.templates`: `"Templates"` → **`"Label presets"`** (plan.md §P7 wording). Placeholder
`nav.comingSoon` (`:276`) stays.

## Commit A — "shell cleanup"

### A0 — i18n + index.html (one writer; owns `en.json` for commit A)

Define these names exactly (A1/A2 write code against them):

- **Add** `fileMenu.home` = `"Home"`.
- **Add** 7 keys under `editor.status` (the readout survivors, moved out of `bottomBar.*`):
  `autoSaveOff`, `autoSaveOn`, `autoSavedJustNow`, `autoSaved` (`"Auto-saved {{time}}"`),
  `lastSavedNone`, `lastSavedJustNow`, `lastSaved` (`"Last saved: {{time}}"`).
  Values are copied verbatim from `bottomBar.*`.
- **Delete** the whole `bottomBar` object (**15** keys: `autoSaveOff`, `autoSaveOn`,
  `autoSavedJustNow`, `autoSaved`, `autoSavedShort`, `autoSaveShortOff`, `autoSaveShortOn`,
  `lastSavedNone`, `lastSavedNotSaved`, `lastSavedJustNow`, `lastSaved`, `lastSavedShort`,
  `shortJustNow`, `tool`, `toggleAutoSave`) and the whole `toolHints` object (**6** keys).
- **Delete** `nav.backToGallery`, `nav.backToGalleryTitle` (dead once BottomBar goes — A3).
- **Value edits**: `about.message` → `"Label Editor v0.1.0\nBuilt with React & Vite"`;
  `index.html:8` `<title>` → `Label Editor`.
- **`src/i18n/locales/` has exactly one file (`en.json`)** — no cross-locale fallout.
- Ordering: the **additions / value edits** land first (wave 1, safe, unblocks A1/A2). The
  **deletions** land in wave 2, after A1/A3 remove the references, then `tsc` is the safety net.
  `toggleAutoSave` is deleted because decision (1) makes the editor readout read-only and the File
  menu keeps its own checkbox.

### A1 — `EditorStatusBar.tsx` (+ its test)  [wave 1, `general`]

- Remove `import { ConnectionChip }` (`:5`) and `<ConnectionChip />` (`:182`). **F1 resolved**: the
  single printer surface is `Header.tsx:250`.
- Add the read-only save readouts into the freed right-hand slot (`justify-between`, `:107`):
  - port `rtf` (`Intl.RelativeTimeFormat`, **keep the defensive `catch` → `'en'` fallback verbatim**),
    the `relative()` ladder (`maxUnit: 'day'` only), the 10 s `setTick` interval (StrictMode-clean),
    and the two status formatters (`getAutoSaveStatus` / `getLastSavedStatus`) from
    `BottomBar.tsx:23-84`.
  - **No compact variants.** Keys now `editor.status.*`.
  - Render as two read-only styled spans (no `<button>`, no `toggleAutoSave`) in a
    `flex items-center gap-2` cluster on the right.
- Update `EditorStatusBar.test.tsx`: assert the two readouts render (`editor.status.lastSavedNone`
  with no save; `lastSaved`/`autoSaved` when `lastSavedAt`/`lastAutoSaveAt` are set), and assert
  **no printer chip** in this component any more.

### A2 — File ▸ Home  [wave 1, `small-coder`]

- `FileMenu.tsx`: new **required** prop `onHome: () => void`; add a `MenuItem`
  `label={t('fileMenu.home')}` → `{ onHome(); onCloseMenu(); }` (place it above `saveProject`).
- `Header.tsx`: read `setView` from the store and pass `onHome={() => setView('gallery')}` at `:152`.
- `FileMenu.test.tsx`: add `onHome: vi.fn()` to the `props` object at `:13-24` and a test that
  clicking Home calls it.

### A3 — delete BottomBar  [wave 1, `small-coder`]

- Delete `src/components/layout/BottomBar.tsx`, `src/components/layout/toolLabels.ts`,
  `src/components/layout/toolLabels.test.ts` (verified: `toolLabel`/`TOOL_LABEL_KEYS` are used only by
  BottomBar + its own test; `bottomBar.*`/`toolHints.*` only by BottomBar).
- `MainLayout.tsx`: drop the import (`:4`) and `{view === 'gallery' && <BottomBar />}` (`:41`).
- Do **not** add a `BottomBar.test.tsx` (handoff suggested one; the component is gone).
- Grep the repo for `BottomBar`, `toolLabel`, `bottomBar.`, `toolHints.`, `backToGallery` after the
  deletion and report any residue.

### A gates

- Wave 2 (A0-deletions) → `node node_modules/typescript/bin/tsc --noEmit` clean →
  `bun run test:run` green → **`review`** (commit A is logic-light;
  `review-fast` is acceptable if `review` is unavailable, but A1's StrictMode/timer port is enough
  logic that `review` is preferred) → fix (≤2) → commit A.

## Commit B — "printer popover"

### B1 — transport + adapter + heartbeat  [wave 1, `general`]

`src/print/transport.ts` (widening) — final shape:

```ts
export interface PrinterRfidInfo {
  tagPresent: boolean;
  usedPaper?: number;
  allPaper?: number;
  consumablesType?: LabelType;
}

export interface PrinterStatus {
  …existing…
  hardwareVersion?: string;
  softwareVersion?: string;
  /** RFID label-tag info, from the connect-time CombinedRfidInfo. */
  rfid?: PrinterRfidInfo;
}
```

- **Reconciled paper dims (do NOT duplicate):** `rollWidthHm`/`rollHeightHm` already derive from
  `rfidInfo.paperInfo` (`niimbotAdapter.ts:119-120`, `hmOf(mm)`). The RFID "dimensions" cell renders
  `hmToMm(rollWidthHm)` × `hmToMm(rollHeightHm)` (`src/core/hm.ts:7`). Do **not** add
  `paperWidthMm`/`paperHeightMm`.
- **No firmware field exists in the lib.** The reference's `HW x SW FW` strip is 4 cells where "FW" is
  just the trailing tag (`PrinterConnector.svelte:119-124`). Port it as
  `HW | hardwareVersion | softwareVersion | FW` — no firmware value.
- `PrinterTransport` gains optional `refreshInfo?(): Promise<void>`.

`src/print/niimbotAdapter.ts`:

- Populate `hardwareVersion`, `softwareVersion` (from `printerInfo`), and `rfid` (from the
  `labelRfidInfo` of the `CombinedRfidInfo` already fetched at `:109` — note `rfidInfo.labelRfidInfo`,
  not `rfidInfo.ribbonRfidInfo`).
- Implement `refreshInfo()`: re-run the `safeFetchPrinterInfo` + `safeFetchRfidInfo` pair (`:316-330`),
  rebuild the connected status (`:111-122` + the new fields), update `this.lastConnected`, emit.
  Must be a no-op-safe throw if not connected (`requireClient()`), and must not clobber `state` while
  `'printing'`.
- **Heartbeat** (`startHeartbeat`/`stopHeartbeat`/`setHeartbeatInterval`):
  - wire `heartbeat` in `wire()` (`:296-304`) — update `lastConnected.batteryPercent` **and** emit;
    `print()` re-emits `lastConnected` when a job settles (`:239-242`) so a stale copy would clobber a
    fresh reading.
  - `setHeartbeatInterval(15_000)` then `startHeartbeat()` on successful connect.
  - `stopHeartbeat()` in `disconnect()` (`:136-152`) **and** on the `connect()` error path
    (`:127-133`) — a rejected connect must not leave a live timer.
  - `heartbeatfailed` must **not** flip status to `'error'` (connection is still up); keep the last
    battery value.
  - StrictMode-idempotent; timer cleared on teardown.

`src/print/mockTransport.ts`: mirror the new fields + a `refreshInfo()` stub (the `?mock=1` dev path
must be able to show the panel).

Tests: `niimbotAdapter.test.ts` (new fields populated from a mocked CombinedRfidInfo; refreshInfo
re-emits; heartbeat starts/stops; failed connect leaves no timer; heartbeat updates battery without a
state flip), `mockTransport.test.ts` (new fields + `refreshInfo` copy semantics).

### B2 — persisted connect method  [wave 1, `general` ∥ B1]

Copy the `gridSpacingHm` (P4) precedent — **6 files**: `storeTypes.ts`, `storeDefaults.ts`,
`slices/settingsSlice.ts` (state + setter + `resetSettings`), `preferenceValidation.ts`
(`PersistedSettings` Pick, `validatePersistedSettings`, `pickPersistedKeys` — keep the
`'key' in persisted` guard), `useStore.ts` (`persistedDefaults` + `partialize`), plus a settings
control in `SettingsModal.tsx` (`GeneralSection`; `forms` exports `SettingRow`/`Select`/`Toggle`).
Default `'bluetooth'`. Add the one settings control key to `en.json` (B2 owns it; B3 runs later so no
collision). Tests: `preferenceValidation.test.ts`.

### B3 — transport swap + the popover  [wave 2, `general`; needs B1 + B2]

- `appTransport.ts`: add `setAppTransportKind(kind)` — if the live transport's kind differs,
  `await disconnect()`, then drop `transport` **and** `runner` together (reuse `resetAppTransport`'s
  body), then lazily rebuild with the new kind. Model:
  `references/niimblue/src/stores.ts:59-73`. **Do not** reuse the test-only `resetAppTransport()` as
  the production path — add the real setter; keep `resetAppTransport` as the seam.
- `ConnectionChip.tsx`: `useMemo(() => getAppTransport(), [])` (`:24`) → depend on the persisted kind
  so a rebuilt singleton is picked up. The effect at `:29-36` already returns the `onStatus`
  unsubscribe.
- **Popover** (top-anchored, so the `bottom-full` row-popup pattern flips to `top-full`):
  copy the popover mechanics from `EditorStatusBar.tsx:56-73` (Escape via capture-phase `keydown` +
  `stopPropagation`, click-outside, focus return, `role="dialog"`).
  - **Connected**: device version strip (HW/SW/FW), RFID label block (usage bar `usedPaper/allPaper`,
    type, `WxHmm`), battery %, model/device name, a **refresh** button → `refreshInfo()`, and
    **Disconnect**.
  - **Disconnected**: capability-filtered chooser — `Utils.getAvailableTransports()` →
    `{ webBluetooth, webSerial }` (`references/.../PrinterConnector.svelte:88-106,269-295`); hide the
    unsupported one and fall back if the remembered kind is unavailable. Plus a **"remember this
    choice"** control wired to the B2 preference.
  - **Drop**: firmware flashing, sound toggles, verbose/advanced dump, debug block, ribbon block.
    Stay inside the owner's scope list — do not invent sub-panels (R7d).
  - Consumables type: reuse the existing `LabelType` → `print.labelTypeNames.*` mapping used by
    `PrintDialog.tsx:73-85` (lift it to a shared helper if it is local). Fallback: raw
    `LabelType[consumablesType]`.
- **⚠ `ConnectionChip.test.tsx:23-26` mocks the whole `appTransport` module factory with only
  `getAppTransport` + `isMockMode`.** Any new export (`setAppTransportKind`) makes that mock incomplete
  and can break the file wholesale — extend the factory **first**, then add popover tests (mocked
  `PrinterStatus`).
- **R7a test**: switch kind and assert `getAppJobRunner()` follows the new transport (the stale-runner
  bug).

### B4 — single-indicator render test  [wave 2, `small-coder`; after B3]

Apple-level: a gallery render + an editor render asserting exactly **one** printer indicator.
In practice: assert `EditorStatusBar` no longer renders `ConnectionChip` (A1 does this) and that the
gallery renders no printer indicator (BottomBar is gone → trivially true). Fold into A1/B3 tests
rather than a new heavy render test unless a cheap home exists. **Implementer's call; report which.**

### B gates

`tsc` clean → full suite green → **`review`** (B carries R7a/R7b; do not downgrade) → fix (≤2 rounds)
→ narrow re-review (`review-fast`) → commit B.

## Fan-out summary

| Wave | Writers (parallel) | Files |
|---|---|---|
| 1 | A0-add (`small-coder`), A1 (`general`), A2 (`small-coder`), A3 (`small-coder`) | en.json adds + index.html; EditorStatusBar(+test); FileMenu/Header(+test); delete BottomBar/toolLabels + MainLayout |
| 2 | A0-del (`small-coder`, same session) | en.json deletions |
| gate | `review` → fix → commit A | |
| 1 | B1 (`general`), B2 (`general`) | print/*; settings preference 6 files + its en.json key |
| 2 | B3 (`general`), B4 (`small-coder`) | appTransport + ConnectionChip(+test) + popover en.json keys; single-indicator assertions |
| gate | `review` → fix → commit B | |

Only one writer touches `en.json` per wave. Depth-1: subagents must not delegate; they emit
`needs-info. q: … . hint: … . next: … .` and stop.

## ENV (repeated)

`bun run test:run [files]` (never `bun test`, never `bunx`/`npx`);
`node node_modules/typescript/bin/tsc --noEmit`. `en.json` at `src/i18n/locales/en.json`. StrictMode
is on. No `git stash`. Semantic commit per phase.

## Risks

- **R7a transport swap staleness** (3 caches: module memo, runner memo, React memo) — B3 + test.
- **R7b `PrinterStatus` widening + heartbeat timer** — B1; reviewers will look at the connect-error
  path, the `lastConnected` refresh, and the no-`error`-flip rule.
- **R7c en.json deletions** — `tsc` on typed `t()` keys is the net; grep before deleting.
- **R7d popover UX is owner-verified manually** — ship one eyeball-able pass.

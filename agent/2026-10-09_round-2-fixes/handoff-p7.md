# Handoff — Phase 7 (Shell & printer surfaces)

> Coordinator handoff. Read with [`plan.md`](plan.md) §P7, [`state.md`](state.md), and
> [`memory/niimblue-reference.md`](../memory/niimblue-reference.md).
> Status: P6 done (`356ccd6` + docs/memory `525ed11`), P7 not started.
> HEAD at handoff: `525ed11`. Full suite green: 120 files / 1522 tests, `tsc` clean.
> Investigation for this phase was read-only (no edits, no delegation).

## Scope (plan.md §P7)

Items: "Top header home button"; "Minor: incorrect branding"; "Leftover status bar artifacts";
"Duplicated printer icon" (F1); "Pressing printer should bring up printer info"; "Template in main UI
confusing" (rename).

Effort is **not** spread evenly. Items 1, 2, 3, 4, 6 are mechanical (<20 lines each). Item 5 — the
printer popover — is the phase. Recommend splitting it into its own commit (see fan-out sketch).

## Owner decision (2026-10-12) — popover content

The connected-state popover should present **mostly the same information as the reference**, with:

- **Firmware flashing dropped.**
- **Keep the reference's UI and layout** (`references/niimblue/src/components/PrinterConnector.svelte:115-267`)
  — owner explicitly likes it — but **re-designed to our style**: same information architecture and
  layout, our colour scheme / component vocabulary.
- **Drop the advanced info, settings, firmware and debug stuff**: the sound-setting toggles
  (`:190-219`), the verbose/advanced JSON dump (`:221-223` + `PrinterVerboseInfo.svelte`, which is
  literally titled "Debug"), the firmware updater (`:224-231`), and the debug/test collapse
  (`:234-251`: heartbeat on/off, printer reset).

Net: keep the **device version block** (HW/SW/FW), the **RFID label-tag block** (usage bar, consumables
type, paper dimensions), **battery**, and **model/device name**. Everything else is out.

## Verified facts to carry in (do NOT re-explore)

### Printer surfaces (F1)

- The plan's ENV BRIEF F1 correction stands: `EditorStatusBar.tsx:182` **does** render
  `<ConnectionChip/>` (real `<Printer>` icon, bottom-right). Remove it + the import at `:5`.
  `EditorStatusBar.test.tsx` contains **zero** connection/chip references — no test blast radius.
- After removal the single printer surface is `Header.tsx:250`, shared across gallery ⇄ editor, so it
  stays mounted for the whole session (matters for the stale-cache issue below).
- The gallery duplicate is `BottomBar.tsx:124-140` (bottom-left, iconless dot + text).

### The transport cannot be swapped by a bare config change — three stale caches

The reference does exactly this swap (`references/niimblue/src/stores.ts:59-73`): compare the wanted
type against the live client's `getType()`, `disconnect()` if different, then `instantiateClient()`.
That shape is the model. Our problem is that **three separate caches hold the transport** and all three
go stale:

1. **Module memo** — `appTransport.ts:40-47`, `transport` is a module-level `let` with no setter.
   `resetAppTransport()` (`:62-65`) is already the right shape (it nulls transport **and** runner) but is
   documented as a test seam and does not disconnect. Add `setAppTransportKind(kind)`: disconnect if
   live → reuse that body.
2. **Runner memo** — `appTransport.ts:50-54`, `getAppJobRunner()` captures `getAppTransport()` at call
   time. Reset only the transport and prints go through the dead instance; `requireClient()` then throws
   "Not connected" (`niimbotAdapter.ts:274-278`). **Both caches must reset together** — free once (1)
   lands, since `resetAppTransport` already does both.
3. **React memo** — `ConnectionChip.tsx:24`, `useMemo(() => getAppTransport(), [])`. Empty deps. Rebuild
   the module singleton and this component still holds the old instance for the whole session. Add the
   persisted kind as a dep; the effect at `:29-36` already returns `onStatus`'s unsubscribe, so the old
   listener cleans itself up.

### Battery polling — the lib's heartbeat is the idiomatic path (owner decision 2026-10-12)

Owner: **poll battery periodically** rather than showing the connect-time value forever. The reference
does this via a client heartbeat (`stores.ts` wires `newClient.on("heartbeat", …)` →
`heartbeatData.set`), and the lib exposes exactly that:

- `startHeartbeat()` / `stopHeartbeat()` / `isHeartbeatStarted()` / `setHeartbeatInterval(ms)` —
  `abstract_client.d.ts:129-148`. `heartbeat` event at `events.d.ts:140`.
- `HeartbeatData` (`dto.d.ts:72-83`) carries `batteryPercents` plus `paperInserted`, `lidClosed`,
  `temp`, `ribbonInserted`, `voltageState` — free extra detail if the panel wants it later.
- Default interval is **2000 ms** (`abstract_client.js:14`) even though the doc comment says 1000
  (stale upstream doc). For a battery readout a popover shows occasionally, that is chatty —
  **recommend `setHeartbeatInterval(15_000)`** before `startHeartbeat()`.

Wiring it correctly is more than calling `startHeartbeat`:

- `NiimbotTransport.wire()` (`:296-304`) already wires `printprogress`/`connect`/`disconnect`; add
  `heartbeat` there and **update `lastConnected`** (`:54`, `:125`) — `print()` re-emits `lastConnected`
  when a job settles (`:239-242`), so a stale copy would clobber a fresh battery reading.
- `stopHeartbeat()` on `disconnect()` (`:136-152`) and on the error path in `connect()` (`:127-133`),
  otherwise a rejected connect leaves a live timer.
- A heartbeat that fails (`heartbeatfailed` event, `events.d.ts:141`) should **not** flip the status to
  `'error'` — the connection is still up. Decide whether it clears the battery reading or leaves it.
- StrictMode-idempotent (`ENV BRIEF`); the interval must be cleared on unmount/teardown.

### Refresh button (owner decision 2026-10-12 — accepted)

Owner: **accept the refresh button.** Add an optional `refreshInfo?(): Promise<void>` to
`PrinterTransport` (`transport.ts:125-133`), implemented on `NiimbotTransport` by re-running the
`safeFetchPrinterInfo` + `safeFetchRfidInfo` pair (`:316-330`) and re-emitting the connected status
built at `:111-122`. `MockTransport` needs a matching stub. The reference's buttons sit on the RFID and
version blocks (`PrinterConnector.svelte:128-130`, `:171`); one shared refresh affordance is simpler and
acceptable. Without this the panel is only ever correct as of connect time.

### The lib already supports serial — no adapter work for the client itself

- `NiimbotClientType = "bluetooth" | "serial" | "capacitor-ble" | "virtual"`; the adapter already takes
  the type (`niimbotAdapter.ts:33-43`, `:269`).
- **Web Serial needs no extra work.** `NiimbotSerialClient.connect()` calls `navigator.serial.requestPort()`
  itself when no `authorizedPort` is passed (`serial_impl.js:20-27`), so the chooser button's user
  gesture flows straight through `transport.connect()`.
- **Our lib version matches the reference exactly** — both `@mmote/niimbluelib@0.47.0`. Every reference
  shape maps 1:1.
- **Capability-gate the chooser.** `Utils.getAvailableTransports()` returns
  `{ webBluetooth, webSerial, capacitorBle }` (`utils.d.ts:1-5`). The reference *hides* unsupported
  methods and falls back when the remembered type is unavailable
  (`PrinterConnector.svelte:88-106`, `:269-295`). Better than the plan's unconditional two-button list,
  and free. (We only need the first two; capacitorBle is the reference's mobile path.)
- The reference's connected chip also switches its icon by transport (`:255-259`, usb vs bluetooth).

### The info panel is NOT presentation-only — `PrinterStatus` must grow

This is the real cost in item 5. `NiimbotTransport.connect()` already fetches **both** `PrinterInfo` and
`CombinedRfidInfo` (`niimbotAdapter.ts:108-109`) but keeps only 5 fields
(`deviceName`/`dpi`/`batteryPercent`/`rollWidthHm`/`rollHeightHm`/`capabilities`, `:111-122`). Everything
else is discarded. Under the owner's scope above we must also surface:

- `hardwareVersion` / `softwareVersion` — `PrinterInfo` (`dto.d.ts:24-25`; note `settings: PrinterSettings`
  is **required**, not optional, so the adapter already tolerates it being present).
- The RFID label block: `tagPresent`, `usedPaper`/`allPaper`, `consumablesType` — `RfidInfo`
  (`dto.d.ts:56-64`), plus `paperInfo.paperWidth`/`paperHeight` (`dto.d.ts:122-132`). All from the
  `CombinedRfidInfo` we **already fetch and throw away**.
- `rollWidthHm`/`rollHeightHm` derive from `rfidInfo.paperInfo` today, so these two overlap — reconcile,
  don't render both (`dto.d.ts:119`).

So `PrinterStatus` (`src/print/transport.ts:88-100`, described as a frozen interface) grows, which means
adapter + adapter test updates. `MockTransport` must be able to report the same fields or the popover
can't be tested in the `?mock=1` dev path.

### Known gaps in the reference-to-ours port

- **The reference's RFID/version blocks each carry a "re-fetch" button** calling
  `$printerClient.fetchRfidInfo()` / `fetchPrinterInfo()` (`PrinterConnector.svelte:128-130`, `:171`).
  Our `PrinterTransport` (`transport.ts:125-133`) has no such method — see the refresh section above;
  owner accepted adding one.
- ~~**Battery goes stale.**~~ **RESOLVED (owner 2026-10-12): poll it.** See the heartbeat section above.
- ~~**No refresh path.**~~ **RESOLVED (owner 2026-10-12): add `refreshInfo?()`.** See above.
- **Popover pattern already exists** — copy `EditorStatusBar.tsx:56-73` (Escape + click-outside + focus
  return + `role="dialog"`, `stopPropagation` so global shortcuts don't fire). The chip's popover is
  top-anchored, so the row popup's `bottom-full` flips to `top-full`.
- `hmToMm` exists at `src/core/hm.ts:7`; the reference renders paper dims in mm.

### Shell items

- **Home action** — `FileMenu.tsx:26-71` is prop-driven with no `setView`; `setView` already exists
  (`storeTypes.ts:144-145`). New `MenuItem` + one prop through `Header.tsx`.
  `FileMenu.test.tsx:13-24` builds its props object explicitly, so a new **required** prop needs one
  line there.
- **Branding — app renamed to "Label Editor" (owner correction 2026-10-12).** The visible branding
  still says "Drawing App" because `template-webui` was a demo drawing app. **Exactly two occurrences:**
  `index.html:8` `<title>` and `about.message` (`en.json:93`, `"Drawing App v0.1.0\nBuilt with React &
  Vite"`). Both → "Label Editor".
  - **Do NOT touch `settings.shortcuts.drawingModifiers`.** plan.md:99 originally listed it; that was
    wrong. Its value is `"Drawing Modifiers"` (`en.json:135`) — the section heading for the modifier
    keys used while drawing, a correct descriptive label, not branding. `plan.md` §P7 has been
    annotated with this correction.
  - Swept the repo: no other "Drawing App"/"drawing app" string exists in `src`, `index.html`, or
    `docs`. (`README.md:1` is `# template-webui` — dev-facing, not visible app branding; out of scope
    unless the owner wants it.)
- **Nav rename** — one key: `NavSidebar.tsx:11-16` `SECTION_LABEL_KEYS.templates` → `nav.templates`
  (`en.json:273`). Placeholder at `:105` stays, per plan.
- **BottomBar cleanup** — 195 lines, gallery-only (`MainLayout.tsx:41`). Removing the tool chip / tool
  hints / the duplicate printer chip leaves only the back-to-gallery button (`:182-191`), which must stay
  (it is the gallery's only nav). The viewport-resize listener (`:60-65`) and `toolLabel`/`toolLabels.ts`
  die with them (`toolLabel` is used only here).
  - **⚠ The last-saved / last-autosaved readouts MOVE to `EditorStatusBar`, they are not deleted.**
    See the next bullet — this is the owner addition and it changes what the cleanup deletes.

- **Save readouts relocate to the editor status bar (owner, 2026-10-12).** The gallery drops them; the
  editor keeps them.
  - **The landing slot already exists and is being freed.** `EditorStatusBar.tsx:107` is
    `flex … justify-between`: the left cluster is zoom/DPI/row-popup, and the right cluster holds
    `<ConnectionChip/>` at `:182` — which this same phase removes (F1). So the chip's removal empties
    exactly the right-hand slot the readouts need. No layout surgery.
  - **What relocates:** the `Intl.RelativeTimeFormat` ladder (`:31-51`), the `relative()` helper, the 10 s
    tick (`:53-58`) — both StrictMode-idempotent — and the status formatters (`:71-100`). Note the
    `Intl.RelativeTimeFormat` construction is deliberately defensive (falls back to `'en'` on a bad BCP-47
    tag); carry that over verbatim, it guards a real crash.
  - **Drop the compact variants.** They exist only for the `isCompact` (<1100 px) mode
    (`BottomBar.tsx:60-67`), and `EditorStatusBar` has no compact mode. One long form each — this kills
    6 keys (`autoSavedShort`, `autoSaveShortOff`, `autoSaveShortOn`, `lastSavedShort`,
    `lastSavedNotSaved`, `shortJustNow`).
  - **Move the i18n keys to `editor.status.*`** rather than leaving them under `bottomBar.*`: they now
    live in the editor status bar, and that namespace already holds zoom/dpi/row. Survivors:
    `autoSaveOff`, `autoSaveOn`, `autoSavedJustNow`, `autoSaved`, `lastSavedNone`, `lastSavedJustNow`,
    `lastSaved`.
  - `toolHints.*`: only 4 of 6 keys are used (select/rectangle/ellipse/line); `callout` and `arrow` are
    already dead. All 6 die with the tool chip.
  - The gallery is not left without save feedback: `LabelCard.tsx:74` already shows a per-label
    "Last updated" date, so dropping the bar readouts loses nothing there.

### Preference plumbing (remember the connect method)

Adding a persisted preference touches **6** files. `gridSpacingHm` (P4) is the exact precedent to copy:
`storeTypes.ts`, `storeDefaults.ts`, `slices/settingsSlice.ts` (state + setter + `resetSettings`),
`preferenceValidation.ts` (`PersistedSettings` Pick, `validatePersistedSettings`, `pickPersistedKeys` —
remember the `'key' in persisted` guard in `pickPersistedKeys:188-195`), `useStore.ts`
(`persistedDefaults` + `partialize`), and a settings-section control. The reference persists the same
thing (`LocalStoragePersistence.saveLastConnectionType`/`loadLastConnectionType`,
`PrinterConnector.svelte:76`, `:91`), defaulting to `"bluetooth"`. Settings UI: add a row to
`GeneralSection` or a new section in `SettingsModal.tsx:30-69`; `forms` exports `SettingRow`/`Select`/`Toggle`.

### i18n — **`en.json` edits are allowed again (owner, 2026-10-12)**

- The batching rule (plan.md #8) is **superseded**. It was written to speed the round up, not to defer
  correctness. P7 is the first phase needing **deletions** and **value edits**, not just additions, and
  deferring those made them easy to get wrong. **Edit `en.json` directly, in this phase, and keep it
  correct** — deletions included. Plan decision #8 carries the dated override.
- **`src/i18n/locales/` contains exactly one file, `en.json`.** No cross-locale fallout; key deletions
  are safe.
- Key accounting for the phase:
  - **Delete 20:** all 14 `bottomBar.*` and all 6 `toolHints.*`. (`bottomBar.tool` dies with the tool
    chip; `toolHints.callout`/`arrow` were already dead.)
  - **Move 7** from `bottomBar.*` → `editor.status.*` with the save readouts: `autoSaveOff`, `autoSaveOn`,
    `autoSavedJustNow`, `autoSaved`, `lastSavedNone`, `lastSavedJustNow`, `lastSaved`. Plus
    `toggleAutoSave` if the auto-save toggle comes along (open question 1).
  - **Value edits (2):** branding — `about.message`; nav rename — `nav.templates`.
  - **Add ~15** for the popover info panel, the connect chooser, and the remember-choice control.
- `settings.shortcuts.drawingModifiers` is explicitly **not** touched.

## Environment / process (carry into the phase)

- Package manager: **bun** at `bun` (never npm). Tests:
  `bun run test:run [files]` (never `bun test`, never `bunx`/`npx`).
  Typecheck: `node node_modules/typescript/bin/tsc --noEmit` (the `.bin/tsc` shim is Windows-only).
- Product strings via `t()` typed keys (`src/i18n/locales/en.json`); dynamic keys via the literal-map
  pattern (`memory/i18n.md`). Global `keydown`/`paste`/`drop` must bail on `<dialog open>`.
  `<React.StrictMode>` is active — effects fire twice; the chip's `onStatus` subscription and the
  StrictMode-guarded mock auto-connect (`ConnectionChip.tsx:27-36`) must stay idempotent across the new
  transport-swap path.
- Depth-1 subagents (no grandchild delegation); no `git stash`; semantic commit **per phase**.
- Reviewer routing: **`review` primary**, `review-alt` fallback, `review-fast` for narrow re-reviews.
- **i18n (owner, 2026-10-12):** **edit `en.json` directly in this phase.** The plan.md #8 batching rule
  is superseded — it was a speed optimisation, and P7 needs key deletions + value edits that are easy to
  get wrong when deferred. Keep deletions accurate alongside the additions.
- **No `ui-designer` this run** (owner instruction #4; owner screenshots are the spec, P10). The popover
  is therefore implemented by `general` from the reference layout + the owner's colour/style direction.
- Owner performs browser/E2E verification manually (no browser-controlling agents).

## Tests worth mirroring

`ConnectionChip.test.tsx` (extends to the popover with a mocked `PrinterStatus`),
`niimbotAdapter.test.ts`, `mockTransport.test.ts`, `appTransport.test.ts`, `FileMenu.test.tsx`,
`preferenceValidation.test.ts`, plus a gallery/editor render test asserting a **single** printer
indicator. New: a `BottomBar` smoke test.

⚠ **`ConnectionChip.test.tsx:23-26` mocks the whole `appTransport` module factory with only
`getAppTransport` + `isMockMode`.** Any new export from that module (e.g. `setAppTransportKind`) makes
the mock incomplete and can break the file wholesale — extend the factory in the same change.

## Risks

- **R7a — transport swap staleness.** The three caches above. If only the module singleton is rebuilt,
  the chip talks to a dead transport and the job runner prints through a stale one. Highest-risk item;
  cover with a test that switches kind and asserts the runner follows.
- **R7b — `PrinterStatus` widening + a heartbeat timer.** A "frozen" interface gains fields;
  `MockTransport` and every status-emitting test must stay truthful. The heartbeat adds a live timer:
  it must be stopped on disconnect **and** on the `connect()` error path, must not let a failed heartbeat
  flip the status to `'error'`, and must keep `lastConnected` fresh so a settling print job does not
  re-emit a stale battery reading. Reviewers will look here.
- **R7c — en.json deletions are now in-phase and unguarded.** With the batching rule lifted, nothing
  catches a key deleted here that another file still calls. Grep every `bottomBar.*` / `toolHints.*`
  reference before removing, and run `tsc` — typed `t()` keys make a stale reference a compile error,
  which is the safety net.
- **R7d — popover UX is owner-verified manually only.** Ship it in a shape the owner can eyeball in one
  pass; avoid inventing extra sub-panels beyond the owner's scope list.

## Open questions for the owner — 3 of 5 resolved 2026-10-12

1. ~~**`settings.shortcuts.drawingModifiers`**~~ **RESOLVED — leave it alone.** plan.md:99 was wrong; it
   named the modifier section by mistake. The branding change is the app rename ("Drawing App" →
   "Label Editor"), which is `index.html:8` + `about.message` only.
2. ~~**`en.json` batching vs P7**~~ **RESOLVED — edit `en.json` directly.** Batching was a speed
   optimisation; correctness wins now.
3. ~~**Battery staleness**~~ **RESOLVED — poll it** via the lib heartbeat, slow interval.
4. ~~**RFID refresh buttons**~~ **RESOLVED — accept**, add `refreshInfo?()`.
5. ~~**Write-only timestamps**~~ **RESOLVED (owner 2026-10-12) — the readouts move, so the fields live.**
   The last-saved / last-autosaved readouts relocate from the gallery `BottomBar` to `EditorStatusBar`,
   so `lastSavedAt` (`docSlice.ts:76-77`) and `lastAutoSaveAt` (`preferencesSlice.ts:9-10`) keep their
   reader. **Do not delete them.** See the relocation bullet under *Shell items*.

   **New open question — the auto-save toggle.** The gallery BottomBar rendered the auto-save status as a
   **clickable** button that called `toggleAutoSave` (`BottomBar.tsx:152-163`). The owner asked for the
   *last-saved / last-autosaved* readouts in the editor. The File menu already carries an auto-save
   checkbox (`FileMenu.tsx:62-66`), so the toggle has a home either way. Question: should the relocated
   status stay clickable in `EditorStatusBar`, or be a read-only display with the File menu as the only
   toggle? (Default if unstated: **read-only** — one obvious way to toggle, and the status bar is the wrong
   place for a settings control. Keeps `toggleAutoSave` out of the editor bar entirely.)

## Action-plan sketch (write `phase7_action-plan.md` before coding)

Suggested **two commits**, because item 5 carries all the risk:

- **Commit A — "shell cleanup" (low risk, mechanical):** home action in the File menu; branding; nav
  rename; remove `<ConnectionChip/>` from `EditorStatusBar`; **relocate the last-saved / last-autosaved
  readouts from `BottomBar` into `EditorStatusBar`'s freed right-hand slot** (with the
  `Intl.RelativeTimeFormat` ladder, the 10 s tick, and 7 `en.json` keys moving to `editor.status.*`);
  strip `BottomBar` down to the back button; sweep the dead keys/files. Fan-out: one writer per file —
  note `EditorStatusBar.tsx` is touched by both the chip removal and the relocation, so keep those two on
  one writer.
- **Commit B — "printer popover" (the phase's real work):**
  1. `PrinterStatus` widening (versions + RFID block) + `NiimbotTransport` populate + `MockTransport`
     mirror + optional `refreshInfo?()` + heartbeat wiring (slow interval, stopped on disconnect *and*
     on the connect-error path, `lastConnected` kept fresh) + adapter/mock tests.
  2. Persisted connect-method preference (6 files, `gridSpacingHm` precedent) + settings control.
  3. `setAppTransportKind` in `appTransport.ts` + the `ConnectionChip` `useMemo` dep fix.
  4. The popover itself — reference layout, our styling — anchored to the top-right chip, plus the
     capability-filtered connect chooser and the refresh affordance.
  5. Extend `ConnectionChip.test.tsx` (mock factory first) + the single-indicator render test.
- Review (`review`) → fix (max 2 rounds) → commit.

## Cross-phase notes from P1–P6 that touch P7

- P2/P3–P5 touch symbol/selection/text paths only — nothing in `src/print/*` or `src/components/layout/*`
  to carry. No interference expected.
- P6's i18n batch already landed 9 `en.json` keys (`editor.mfp.global*`, `trust.prompt.*`); none collide
  with P7's names.
- P4 deleted `gridConstants.ts`; the grid step is the persisted `gridSpacingHm` — the same
  persisted-preference pattern P7 needs for the connect method.

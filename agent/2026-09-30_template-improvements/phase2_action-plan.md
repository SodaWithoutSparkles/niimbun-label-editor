# T2 — Dialog System · Action Plan

**Phase:** T2 of T4 · **Depends on:** T1 (`fc59580`) · **Blocks:** T3
**Reviewer:** `review-alt` (primary `review` is region-blocked — see state.md)
**Commit:** one commit on `main` — `feat(dialogs): one shared Modal replacing native dialogs and the imperative export UI`

## Exit criteria (from plan.md T2)

1. Zero `window.alert` / `window.confirm` / `window.prompt` references.
2. Zero imperative DOM injection.
3. One dialog implementation repo-wide.

## Deviations from plan.md — decided, with reasons (reviewers: read this before filing)

- **D-a · 11 native dialog sites, not 8.** Recon found 3 the plan missed: `Header.tsx:289` (`prompt`), `RightSidebar.tsx:366` (`confirm`), `HelpMenu.tsx:28` (`alert`). All are in scope — the exit criterion is zero references, not zero references from a list.
- **D-b · Exit criterion 3 lands at T3, not T2.** `ShortcutConfigModal` is a legacy overlay, but **T3 deletes it** (absorbed into the Settings "Shortcuts" section). Re-shelling it onto `Modal` in T2 would be throwaway work. T2 leaves it alone; T3 removes it. Criterion 3 is met once T3 ships. Do **not** file this as a T2 defect.
- **D-c · `ToolSettingsModal` is not a dialog.** It is a deliberately *modeless*, non-blocking panel (its own source comment: "Removed click outside listener to make it non-blocking/modeless"). It is not part of the dialog system and is not migrated.
- **D-d · Strings are extracted in T2 for anything T2 writes.** T4's scope lists "Header confirm/prompt copy, HelpModal copy, export modal". T2 rewrites those exact lines; extracting in T2 avoids writing them twice. T4 keeps: ErrorBoundary, menus, canvas components, settings sections, remaining Header chrome, and the `Intl.RelativeTimeFormat` swap. **T2 must leave no hardcoded new string behind.**
- **D-e · One small addition to the plan's file list: `AlertDialog`.** Two `alert()` call sites are an *About* box (`OptionsMenu.tsx:27`, `HelpMenu.tsx:28`). Routing those to a toast is a semantic downgrade; a bespoke component would violate criterion 3. `AlertDialog` is `ConfirmDialog` with one button and completes the family. Everything else about the file list is as planned.
- **D-f · The 4 error `alert()`s become notifications, not dialogs.** `Header.tsx:181,191,226,256,355` are transient failure reports; `NotificationCenter` already exists for this (`addNotification`, `type: 'error'`). Non-blocking is better than the current blocking `alert`. The plan permits "themed dialog or NotificationCenter".

## Design (decided — implement as specified)

### The base: one `Modal` on native `<dialog>`

Port the proven pattern from `web-consoles/src/components/SettingsModal.tsx:33-62` (a sibling repo, `web-consoles` — read it). It is battle-tested; do not invent a different lifecycle.

- Native `<dialog>` + `showModal()`. The top layer gives focus trap, focus restore and background inertness for free. **No focus-trap library, no body-scroll-lock code, no hand-rolled z-index.**
- `createPortal` to `document.body`. Two reasons, both real here: (1) `Header.tsx:459-461` renders a `fixed inset-0 z-[-1]` menu backdrop with an onClick that closes menus — an inline dialog would let clicks bubble into Header's handlers; (2) it escapes ancestor `overflow-hidden` and `z-50` stacking contexts.
- **StrictMode**: effects fire twice. Port the idempotent guards verbatim:
  `if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close();`
- **Escape**: `onCancel={onClose}` **and** an explicit `onKeyDown` Escape check — native Escape is unreliable across browsers, which is why web-consoles does both.
- **Backdrop close via pointer origin**: a text-selection drag can start inside the dialog and end on the backdrop. Track `pressedBackdropRef` on `onPointerDown`, and only close on `onClick` when the press *also* started on the backdrop. Port exactly (`SettingsModal.tsx:57-62`).
- Props:
  ```ts
  interface ModalProps {
      open: boolean;
      onClose: () => void;
      title?: string;
      ariaLabel?: string;        // used when there is no title
      headerActions?: ReactNode; // rendered left of the built-in close button
      footer?: ReactNode;
      size?: 'sm' | 'md' | 'lg' | 'xl';
      className?: string;        // merged via cn() for one-off overrides
      children: ReactNode;
  }
  ```
- Built-in close button: `aria-label={t('dialog.close')}`, `title` likewise.
- Layer note: a `showModal()` dialog sits in the **top layer**, which always beats `z-index` — so it will cover `NotificationCenter` (`z-[200]`). Accepted; do not add z-index hacks.

### The imperative API (promise-based, callable outside React)

Needed because `Header` calls these from async event handlers. A module store + `useSyncExternalStore`, **not** a new zustand slice — pending dialog state is transient UI state, not app state, and it must be resolvable from non-component code.

`src/components/common/dialogs/dialogService.ts`:
```ts
// one pending request at a time; a second call resolves the first as cancelled
type DialogRequest =
    | { kind: 'confirm'; title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
    | { kind: 'prompt';  title?: string; message: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string }
    | { kind: 'alert';   title?: string; message: string; confirmLabel?: string };

export function confirm(req: Omit<ConfirmRequest,'kind'>): Promise<boolean>
export function promptText(req: ...): Promise<string | null>   // resolves null on cancel
export function alert(req: ...): Promise<void>
export function subscribe(listener: () => void): () => void
export function getPending(): PendingDialog | null
```
- Naming: export `confirm` / `prompt` per the plan — callers read `if (!(await confirm({...}))) return;`. Existing call sites already write `window.confirm`, so there is no reliance on the global.
- **Multi-line messages render with `whitespace-pre-line`** so the existing `\n\n`-separated copy renders as paragraphs. This keeps every migrated message **byte-identical** to today's — important, because reviewers will diff the copy.
- Default labels must stay `OK` / `Cancel`, because the migrated copy literally says "Click OK to overwrite" / "Click Cancel to abort".

### Components

`src/components/common/dialogs/`
- `Modal.tsx` — the base (above)
- `ConfirmDialog.tsx` — title?, message, danger styling, Cancel + confirm buttons
- `PromptDialog.tsx` — like confirm plus a text input (reuse `forms/Input`); Enter submits, Escape cancels; `autoFocus` the input
- `AlertDialog.tsx` — message + single OK button
- `DialogHost.tsx` — `useSyncExternalStore(subscribe, getPending)`; renders whichever dialog is pending and wires its resolve
- `index.ts` — barrel: `Modal`, the three dialogs, `DialogHost`, `confirm`, `promptText`, `alert`

Mount `<DialogHost />` once in `src/App.tsx` beside `<NotificationCenter />`. **Exactly one mount.**

Presentation: match the existing dark palette (`Modal` chrome from `HelpModal.tsx` — `bg-gray-900`, `text-white`, `border-gray-700`, `rounded-lg`, `shadow-2xl`). Buttons: reuse the pattern already in `Header.tsx` / `RightSidebar.tsx`. Do **not** invent a new `Button` component in this phase.

### Call-site migration — the 11 sites

| file:line | today | becomes |
|---|---|---|
| `Header.tsx:140` | `window.confirm(...)` long warning, gates save-overwrite | `if (!(await confirm({ message: t('header.confirmOverwriteCleared') }))) return;` |
| `Header.tsx:150` | `window.confirm(...)` empty-canvas save | `if (!(await confirm({ message: t('header.confirmSaveEmpty') }))) return;` |
| `Header.tsx:181` | `alert('Failed to save project')` | `addNotification({ type: 'error', message: t('errors.saveFailed') })` |
| `Header.tsx:191` | same string | same |
| `Header.tsx:226` | `alert('Failed to load project file')` | `addNotification({ type: 'error', message: t('errors.loadFailed') })` |
| `Header.tsx:256` | `alert('Failed to open project file')` | `addNotification({ type: 'error', message: t('errors.openFailed') })` |
| `Header.tsx:289` | `prompt('Paste an image URL')` | `const url = await promptText({ message: t('header.promptImageUrl') })` — then the existing `if (!url) return;` and `url.trim()` logic is unchanged |
| `Header.tsx:355` | `alert('Failed to save project')` | `addNotification({ type: 'error', message: t('errors.saveFailed') })` |
| `OptionsMenu.tsx:27` | `alert('Drawing App v0.1.0\nBuilt with React & Vite')` | `alert({ title: t('about.title'), message: t('about.message') })` |
| `HelpMenu.tsx:28` | same | same |
| `RightSidebar.tsx:366` | `window.confirm('WARNING: This will delete ALL objects...')` | `if (await confirm({ message: t('rightSidebar.confirmClearAll'), danger: true })) deleteAllItems();` |

- Handlers containing an `await` become `async`. Keep `onClick={() => { void handleX() }}` style consistent with what is already there — do not introduce floating-promise lint noise.
- `AddNotification` is already available in the store; `Header` must pull it via `useStore`.
- Do **not** change any behaviour beyond the dialog swap. Same conditions, same early returns, same order.

### HelpModal → `Modal`

`src/components/help/HelpModal.tsx` keeps its `{ isOpen, onClose }` props (its mount in `Header.tsx:519` stays unchanged) but its body becomes a `Modal`. Drop the hand-rolled overlay + the raw `✕` button. Extract its 2 paragraphs + title + close label to `t()` (D-d).

### ExportModal — kill the DOM injection

Currently `useCanvasExport.ts` injects a `<style>` tag and `document.body.appendChild(modal.innerHTML = …)`, then wires listeners by `querySelector`. That whole path dies.

- **Delete**: `src/components/canvas/hooks/export/template.ts`, `src/components/canvas/hooks/export/styles.ts`, and `src/components/canvas/hooks/useCanvasExport.ts`.
- **Keep** `export/utils.ts` — already pure (`computeTrimBounds`, `computeTrimBoundsFromDataUrl`).
- **Extract to pure functions** (new files under `src/components/canvas/hooks/export/`):
  - `capture.ts` — `captureStageData(stage, tr, pixelRatio)` → `{ dataUrl, width, height }`, including the temporary transformer clearing/restore that `useCanvasExport.ts:22-43` does today.
  - `download.ts` — `downloadDataUrl(dataUrl, filename)` (the `<a download>` click, as a plain function).
- **New** `src/components/canvas/ExportModal.tsx` — a React component on the shared `Modal`.
  - Props: `{ open, onClose, stageRef, trRef, defaultFilename }`.
  - On `open` (effect, guarded — StrictMode runs it twice): capture the stage, run trim detection, produce the preview. Show `t('export.capturing')` while working.
  - Local state for `filename`, `ext`, `scale`, `quality`, `trim` — replacing the DOM reads.
  - Preview `<canvas>` drawn via a plain function, not `querySelector`.
  - Download button calls `downloadDataUrl`; disabled until the preview is ready (matching today's `disabled` attribute).
  - `useCanvasExport.ts:108` swaps the quality hint between `JPG/WebP only` and `PNG ignores quality` by ext — keep that behaviour via state, not DOM text assignment.
- **Store change** (`src/store/slices/preferencesSlice.ts`): `exportTrigger: number` + `triggerExport()` is an increment-counter used as an open flag, which cannot express "closed". Replace with `isExportModalOpen: boolean`, `openExportModal()`, `closeExportModal()`. Update `Header.tsx:398` (`onExport`) and `DrawingCanvas.tsx:99`.
- **Behaviour must be preserved exactly**: same capture `pixelRatio`, same scale range `0.5–3 / step 0.1`, same quality range `0.5–1 / step 0.02` default `0.92`, same trim semantics, same default filename `drawing-export`, same `Preview ready • W × Hpx` readout. Read the old hook in full and port the maths verbatim.

## Catalogue (`src/i18n/locales/en.json`)

Written by **C1 only** (solo, before anything else) so later parallel work never races on this file. `dialog.*` and `export.*` as specified; the `header.confirm*` / `errors.*` / `about.*` / `rightSidebar.*` / `help.*` keys as specified in the C1 task. Extensions (`.png`) and numeric readouts stay out of the catalogue — they are data, not copy.

Multi-line messages are stored with real `\n` escapes and rendered with `whitespace-pre-line`, byte-identical to today's strings.

## Execution order

```
C1 (Modal base + full en.json catalogue)          ← solo, everyone depends on it
        │
        ├─► C2 (dialogService + 3 dialogs + DialogHost)   ─┐ parallel, disjoint files
        └─► C4 (ExportModal + pure fns + store)           ─┘
                    │
                    └─► C3 (HelpModal + all 11 call sites)   ← last, owns Header.tsx
```

C3 runs last so exactly one agent ever edits `Header.tsx`.

## Verification

1. `bun run build` (`tsc && vite build`) green.
2. `grep -rn "window\.\(alert\|confirm\|prompt\)\|\balert(\|\bconfirm(\|\bprompt(" src/` — only the new `confirm(`/`promptText(`/`alert(` imports from the dialog module may remain. Zero `window.*` forms. Paste the output as evidence.
3. `grep -rn "innerHTML\|appendChild\|createElement\|querySelector\|insertAdjacentHTML" src/` — must be clean (the `<a download>` in the new `download.ts` is the one allowed `createElement`, and it is created in memory, not injected).
4. `grep -rn "createPortal" src/` — exactly one implementation, in `Modal.tsx`.
5. Confirm `template.ts` / `styles.ts` / `useCanvasExport.ts` are gone.
6. `DialogHost` is mounted exactly once (`App.tsx`).

## Review focus

Ship the reviewer: the verbatim old→new copy for all 11 sites (so it can diff the copy), the grep evidence above, and the full old `useCanvasExport.ts` next to the new `ExportModal.tsx` so the export maths can be compared line by line. Reviewer cannot run commands (state.md) — the parent supplies all command output.

Reviewer must specifically rule on: StrictMode double-invoke safety; Esc + backdrop-pointer-origin correctness; the promise resolver never leaking (a dialog closed by unmount must still resolve, or a caller's `await` hangs forever); `whitespace-pre-line` actually preserving the original line breaks; and export-behaviour parity.

## Risks

| Risk | Mitigation |
|---|---|
| A closed-without-resolving dialog hangs an `await` forever | Resolver must fire on **every** exit path: confirm, cancel, Esc, backdrop, and unmount. Review explicitly checks this. |
| StrictMode double `showModal()`/`close()` | Port web-consoles' idempotent guards; the reviewer smoke-checks the lifecycle. |
| Export maths silently drifting in the rewrite | `export/*.ts` pure functions + old-vs-new side-by-side in review; no behaviour change permitted. |
| `Modal` covering toasts (top layer beats `z-[200]`) | Accepted, documented, not solved. |
| Two agents editing `Header.tsx` | C3 runs last and owns it; C2/C4 are barred from the file. |

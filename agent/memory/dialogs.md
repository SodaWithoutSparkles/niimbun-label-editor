# Dialogs

One implementation repo-wide: `src/components/common/dialogs/`. Never add a second overlay.

## `Modal` — the base

`Modal.tsx` wraps a native `<dialog>` + `showModal()`, portaled to `document.body`.
- Top layer gives focus trap, focus restore, background inertness for free — no focus-trap lib, no scroll-lock, no z-index hacks.
- Portal escapes ancestor `overflow-hidden`/stacking contexts and keeps clicks from bubbling into layout handlers (e.g. Header's menu backdrop).
- Effects are idempotent (`if (open && !dialog.open) showModal(); else if (!open && dialog.open) close()`) so React 19 StrictMode double-invoke is safe.
- Escape closed explicitly via `onKeyDown` (native Escape is unreliable across browsers) **and** `stopPropagation` so it doesn't also reach window-level Escape handlers (canvas cancel). `onCancel` also wired.
- Backdrop close tracks `pressedBackdropRef` on `onPointerDown` and only closes when the press *started* on the backdrop — a text-selection drag starting inside the dialog must not close it.
- Callers pass one-off sizing via `className`, merged with `cn()`. Beware tailwind-merge group collisions: `w-[75vw]` (group `w`) unions fine with `max-w-md`, so `SettingsModal` must also pass `max-w-none` (same `max-w` group, last wins) or the width caps at 28rem.

## Promise dialog service

`dialogService.ts` is a **module store**, not a zustand slice — pending dialog state is transient and must be resolvable from non-React code (async event handlers).
- `confirm()` → `Promise<boolean>`, `promptText()` → `Promise<string | null>`, `alert()` → `Promise<void>`.
- One request pending at a time. A new request settles the previous one as cancelled first.
- **Contract: every exit path settles exactly once.** Confirm, cancel, Escape, backdrop, the close button, host unmount, and displacement by a new request all route through `resolvePending()`. A closed-without-resolving dialog hangs a caller's `await` forever — this is the contract to preserve.
- `resolvePending` clears `pending` **before** resolving so a re-entrant render never sees an already-settled dialog.
- `DialogHost` subscribes via `useSyncExternalStore`, keys each dialog by request `id` (displaced dialog remounts fresh), and settles on unmount. Mount **exactly once** in `App.tsx`.

## Multi-line messages

Stored with real `\n` and rendered `whitespace-pre-line`, so migrated copy stays byte-identical. Default button labels stay `OK` / `Cancel` because existing copy says "Click OK…" / "Click Cancel…".

## PITFALL — Tailwind preflight vs the UA cascade

**This shipped a real bug that two static reviews missed.** Tailwind preflight is *author* CSS and beats the UA stylesheet regardless of specificity. So:
- `.flex` on the `<dialog>` overrode the UA's `dialog:not([open]) { display: none }` → every closed Modal rendered as a visible box.
- `* { margin: 0 }` overrode `dialog { margin: auto }` → the box pinned top-left.

Fix, kept as inline guards in `Modal.tsx`:
- Only apply `flex` when `open`; apply `hidden` when not; add `[&:not([open])]:hidden` as a 0,2,0-specificity backstop against a display utility smuggled in via `size`/`className`.
- Centre deterministically: `fixed inset-0 m-auto h-fit` + a definite width capped by `max-w-*` — do not rely on UA `margin:auto` or UA insets.

**Rule: any change to `Modal`, or any new `<dialog>`-based component, needs a real browser pass. A reviewer reading source cannot see this class of cascade bug.**

## Automation gotchas (headed checks)

- **Closed dialogs stay in the DOM.** `Modal` portals every mounted dialog to `document.body` and hides it with `:not([open])`. So `document.querySelectorAll('button')` sees buttons from **closed** dialogs too — an unscoped `.find(text === 'Cancel')` can click the wrong (hidden) dialog. Scope to the open one: `document.querySelector('dialog[open]')` then query within.
- **Do not mount a dialog closed if its children do expensive/data work.** A closed-but-mounted dialog's hooks still run (this caused a trust-prompt-while-closed bug in P7). Mount only while open, and/or gate the hook on `open`.
- `ab`'s `find role button click --name …` is unreliable on these dialog buttons; a scoped DOM `eval` click (`dialog[open]` → button → `.click()`) is reliable.

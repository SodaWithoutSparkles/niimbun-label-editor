# Warning center

A persistent-in-session list of editor warnings, as the **5th MFP tab "Warnings"** (`src/components/editor/WarningsTab.tsx`, next to JS). Built in ui-sweep P6 (2026-10-08).

## Seam

- **Types:** `src/editor/warnings.ts` — `EditorWarning` union, `EditorWarningGroup` (`{ docId, scopeId?, warnings }`), `EditorWarningSource = 'preview' | 'fonts' | 'csv' | 'print'`.
- **Store:** `src/store/slices/warningsSlice.ts` — `editorWarnings: Partial<Record<source, group>>`, `setEditorWarnings(source, group|null)`, `clearEditorWarnings(source, scopeId?)`. Flat slice; declared in `storeTypes.ts`.
- **Pure builders:** `src/editor/previewWarnings.ts` — `buildPreviewWarnings(doc, inputs)` and `buildFontWarnings(doc, badges)`; unit-tested, kept out of the Konva component.
- **Producers:** `PreviewStage` (asset `missing|invalid|too-small`, keep-out, global-data, template error/blocked/needs-approval/sample-row, fonts), `DataSourceTab` (CSV `empty`/`parse-error`/`rows-capped`), `PrintDialog` (print doc-level: ink-aware `overflow`, `interleaved`, `mismatch`, `policy-overflow`, `mirror-clipped`).
- Node entries carry `nodeId` and **jump via `selectNode`**; doc-level entries are plain text (non-jumpable).

## Rules & gotchas

- The node ⚠ badge stays **generic** (`ResolvedShape.tsx` untouched) — detailed per-kind text lives only in the warning center.
- **QR data is arbitrary text — never validate/guess it as a URL.**
- Groups are scoped by `docId`; CSV also by `csvId` (`scopeId`). `WarningsTab` filters stale scopes.
- **CSV publishes at parse time and is NOT cleared on `DataSourceTab` unmount** — `MfpPanel` unmounts inactive tabs, so an unmount cleanup would hide the group the moment the user opens the Warnings tab. Cleanup is scope-based (detach clears with `clearEditorWarnings('csv', csvId)`).
- **Print warnings clear when the print dialog closes** (the dialog is modal, mounted only while open) — accepted, not a bug.
- Keep-out excludes nodes that are not **effectively visible** (`effectiveVisible`), including nodes inside a hidden group, matching the canvas badge.
- The font producer is keyed on `doc.meta.id` + `doc.resources.fonts` + per-node `${id}:${fontId}` keys — **not whole-doc identity** — because `updateNodeTransient` mints a new `currentDoc` on every pointer-move and would otherwise re-run IndexedDB reads per drag frame.
- Do **not** reuse `NotificationCenter` (auto-dismiss).
- Preview≡print stays by construction (single `renderLabelPage` seam); the editor canvas is never quantized.

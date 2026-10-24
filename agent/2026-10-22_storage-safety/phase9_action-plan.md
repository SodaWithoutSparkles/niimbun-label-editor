# P9 — Persist print offset per label

Source: upstream survey `a944429` (preset print offset); folded plan P9.

## Goal

The print dialog's X/Y/type offset resets to `0 / 0 / inner` every open. Persist
it on the label so a tuned offset survives close/reopen and reprints.

Offsets are stored in **hm (0.1 mm)**, not device px: the dialog works in printer
dots at the *resolved* dpi, which may differ between sessions/printers. hm keeps
the physical offset stable.

## Deliverables

### 1. `src/core/doc/types.ts`

```ts
/** Last-used print offset, device-independent (hm). */
export interface PrintOffset {
    xHm: hm;
    yHm: hm;
    /** `outer` grows the raster; `inner` shifts within it. */
    type: 'inner' | 'outer';
}
```

On `LabelDoc.label`, after `printDirection`:

```ts
/**
 * Last-used print offset. Optional: absent means no offset (the printer default).
 * Stored in hm, converted to device px at the resolved print dpi.
 */
printOffset?: PrintOffset;
```

### 2. `src/core/doc/validate.ts`

Next to `PRINT_DIRECTIONS`, add:

```ts
/** ±100 mm: far beyond any real correction, and keeps the raster finite. */
const PRINT_OFFSET_LIMIT_HM = 1000;

const normalizePrintOffset = (value: unknown): PrintOffset | undefined => {
    if (!isRecord(value)) return undefined;
    const { xHm, yHm, type } = value;
    if (!Number.isInteger(xHm) || !Number.isInteger(yHm)) return undefined;
    if (Math.abs(xHm) > PRINT_OFFSET_LIMIT_HM || Math.abs(yHm) > PRINT_OFFSET_LIMIT_HM) return undefined;
    if (type !== 'inner' && type !== 'outer') return undefined;
    return { xHm, yHm, type };
};
```

In the label build: `const printOffset = normalizePrintOffset(labelRaw.printOffset);`
and add `...(printOffset ? { printOffset } : {})` to the returned `label`.
An invalid optional field is **dropped**, not an error: it is a print
convenience, and a rejected doc would be a worse outcome than a reset offset.
Use the existing `isRecord` helper.

### 3. `src/core/doc/factory.ts`

- `CreateLabelDocOptions` gains `printOffset?: LabelDoc['label']['printOffset']`.
- `createLabelDoc` sets `...(options.printOffset ? { printOffset: { ...options.printOffset } } : {})`
  in `label`.

### 4. `src/store/storeTypes.ts` + `editorSlice.ts`

```ts
/**
 * Persist the print offset on the named document as one undo entry. `docId`
 * guards a late dialog unmount from writing doc A's offset onto doc B.
 * `undefined` clears it.
 */
setPrintOffset: (offset: PrintOffset | undefined, docId: string) => void;
```

Implementation mirrors `setPrintDirection`:

- `const doc = get().currentDoc; if (!doc || doc.meta.id !== docId) return;`
- No-op when unchanged (both absent, or each field equal) — no undo entry.
- Else `cloneDoc`, assign or `delete next.label.printOffset`, `commit(next, doc)`.

### 5. `src/components/editor/EditorShell.tsx`

Pass `onPrintOffsetChange={setPrintOffset}` (from the store) to `PrintDialog`.

### 6. `src/components/print/PrintDialog.tsx`

- Prop: `onPrintOffsetChange?: (offset: PrintOffset | undefined, docId: string) => void`
  (optional, like the other doc setters; harnesses omit it).
- `resolved.dpi` is the conversion basis.
- Initialise on open, in the existing reset effect (or a new one placed after
  `resolved`): read `doc.label.printOffset` and set
  `offsetX = String(Math.round(xHm * resolved.dpi / 2540))`, same for Y, and
  `offsetType`. Absent ⇒ `'0' / '0' / 'inner'` (current behaviour).
- Commit on unmount (the dialog is mounted only while open):

```ts
const offsetRef = useRef({ x: offsetX, y: offsetY, type: offsetType, docId: doc.meta.id });
offsetRef.current = { x: offsetX, y: offsetY, type: offsetType, docId: doc.meta.id };
const commitOffsetRef = useRef(onPrintOffsetChange);
commitOffsetRef.current = onPrintOffsetChange;
const dpiRef = useRef(resolved.dpi);
dpiRef.current = resolved.dpi;
useEffect(
    () => () => {
        const { x, y, type, docId } = offsetRef.current;
        const px = Number.parseInt(x, 10);
        const py = Number.parseInt(y, 10);
        if (!Number.isInteger(px) || !Number.isInteger(py)) return;
        const offset =
            px === 0 && py === 0
                ? undefined
                : { xHm: Math.round((px * 2540) / dpiRef.current), yHm: Math.round((py * 2540) / dpiRef.current), type };
        commitOffsetRef.current?.(offset, docId);
    },
    [],
);
```

Rule: persist only on unmount (one undo entry), never per keystroke.

### 7. Tests

- `src/core/doc/validate.test.ts`: a valid `printOffset` round-trips; a
  non-integer / out-of-range / bad-type value is dropped while the doc still
  validates.
- `src/core/doc/factory.test.ts` (or the nearest existing factory test): option
  round-trip.
- `src/store/slices/editorSlice.test.ts`: `setPrintOffset` writes the doc as one
  undo entry; equal values are a no-op; a mismatched `docId` is ignored.
- `src/components/print/PrintDialog.test.tsx`: opening with a stored offset
  shows the converted dots; unmounting reports the hm offset once (and reports
  `undefined` for 0/0).

## Constraints

- Do not change the offset's runtime meaning or the renderer.
- No new dependencies. 4-space indent, single quotes.
- The dialog is mounted only while `isPrintOpen`; rely on unmount, not an
  `open` transition.
- Keep all existing PrintDialog tests compiling: the new prop is optional.

## Done when

- `bun run test -- src/core/doc/validate.test.ts src/core/doc/factory.test.ts src/store/slices/editorSlice.test.ts src/components/print/PrintDialog.test.tsx` passes.
- `node node_modules/typescript/bin/tsc --noEmit` clean.

# Wave 4 · Phase 20 — Export only referenced assets (owner, 2026-10-29)

- Date: 2026-10-29
- Baseline: `main` @ `0209cb9`
- Reviewer: `review` (data-loss / bundle contract)
- Commit: `fix(bundle): export only the assets the label actually uses`

## Failure mode (confirmed)

`buildBundle` inlines **every entry in `doc.resources.images` / `doc.resources.fonts`**
(`src/data/bundle.ts:176-188`). That registry is append-only:
`removeNode` never prunes `doc.resources.*` (documented at `src/data/orphans.ts:13-18`,
and relied on there — the orphan sweep is *conservative* and counts registry
entries as references).

So "Export this label" (`useLabelTransfer.ts:219`, `buildBundle([currentDoc])`)
carries every image ever inserted into that document, including ones whose node
was deleted long ago, as full inline base64 — a bundle that leaks unused
pictures and can hit the 64 MB import cap for no reason. Same for "Export all"
(`:260`).

## Design (fixed)

Prune the **exported copy** to what the nodes use, then inline what is left.

```ts
/** Asset refs a document's nodes actually use. */
const referencedAssetIds = (doc: LabelDoc): {
    imageIds: Set<string>;      // node.type === 'image' → node.imageId
    fontIds: Set<string>;       // node.type === 'text' → node.fontId (when set)
    fontFamilies: Set<string>;  // node.type === 'text' → node.fontFamily (legacy docs: no fontId)
};
```

In `buildBundle`, after the `structuredClone`:

1. `copy.resources.images = copy.resources.images.filter((ref) => imageIds.has(ref.imageId))`
2. `copy.resources.fonts = copy.resources.fonts.filter((ref) =>
       fontIds.has(ref.fontId) || fontFamilies.has(ref.familyName))`
   — the family clause keeps imported fonts that legacy text nodes reference by
   name only (`resolve.ts:483` uses `node.fontFamily`; `ensureFonts(doc)`
   registers whatever is in the registry).
3. Inline/CSV loops run over the **pruned** arrays.

Semantics:

- `missing` counts only **referenced** refs whose bytes cannot be read. An
  unreferenced unreadable ref is pruned, not reported — it is not missing
  anything the bundle needs.
- The exported document is self-consistent: every `node.imageId` / `node.fontId`
  it keeps has a registry entry, and no registry entry lacks a consumer.
- `local`, `inline`, `remote` and `external` refs are all filtered by the same
  node-reference rule (an unreferenced inline image also bloats the bundle).
- No change to the import side, no change to the in-memory document, no change
  to the orphan sweep's conservative rule (that one protects bytes; this one
  decides what to *ship*).

Edge cases to hold:

- an image node whose `imageId` has no registry entry: nothing to export, the
  node stays as is (already-broken ref, unchanged behaviour);
- two image nodes sharing one `imageId`: one entry, inlined once;
- a document with no nodes: empty `resources`, empty arrays — a valid bundle.

## Files

| File | Change |
| --- | --- |
| `src/data/bundle.ts` | `referencedAssetIds`, prune before inlining, doc updates (`:14-30`, `buildBundle` doc) |
| `src/data/bundle.test.ts` | fixtures gain referencing nodes; new pruning cases |
| `src/components/layout/useLabelTransfer.test.tsx` | only if it asserts the carried registry |

## Tests

`src/data/bundle.test.ts`:
- a doc with **two registry images, one referenced** → the bundle's registry has
  one entry, inlined, and the unused bytes' base64 never appears in the JSON;
- same for fonts: one referenced by `fontId`, one referenced only by
  `fontFamily`, one unused → two kept, the unused dropped;
- unreferenced **unreadable** ref → pruned, `missing === 0`;
- referenced **unreadable** ref → kept as `local`, `missing === 1` (the existing
  semantic, now scoped to referenced refs);
- an unreferenced `inline`/`remote` ref is dropped too;
- existing round-trip tests (`build → import`) still pass with pruned input and
  produce a doc whose nodes resolve.

## Risks

| Risk | Mitigation |
| --- | --- |
| Pruning a font a legacy node needs | The `familyName` clause keeps it; a test pins a family-only reference |
| Imported doc missing an asset | Only refs no node uses are dropped; the exported doc is self-consistent by construction |
| Hiding a genuinely broken ref | `missing` still counts every **referenced** unreadable ref, unchanged wording |
| Changing the orphan sweep's rule by accident | `orphans.ts` is not touched |

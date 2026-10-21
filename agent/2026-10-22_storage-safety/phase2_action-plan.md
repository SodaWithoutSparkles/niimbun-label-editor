# P2 — Single-item delete guard

## Goal

Deleting one CSV table or media record must never be an unguarded action. The
handler checks a fresh reference inventory first and picks the confirm message
from the result. The user keeps the override; the accidental path disappears.

## Deliverables

### 1. `src/components/gallery/CsvSection.tsx` — `handleDelete`

Replace the current body with:

```ts
const handleDelete = async (record: CsvRecord) => {
    const fresh = await orphans.reload();
    const verified = fresh !== null && fresh.complete;
    const orphan = verified && fresh.csvIds.has(record.id);
    const message = !verified
        ? t('csvs.deleteUnverifiedConfirm', { name: record.name })
        : orphan
          ? t('csvs.deleteConfirm', { name: record.name })
          : t('csvs.deleteInUseConfirm', { name: record.name });
    const ok = await confirm({ danger: true, message });
    if (!ok) return;
    await remove(record.id);
};
```

### 2. `src/components/gallery/MediaSection.tsx` — `handleDelete`

Same shape with `resourceIds` and `media.*` keys (`record.name ?? record.id` for
the name, matching the existing message).

### 3. `src/i18n/locales/en.json`

Add after each `deleteConfirm`:

- `csvs.deleteInUseConfirm`: `"\"{{name}}\" is used by a label. Deleting it will break that label. Delete anyway?"`
- `csvs.deleteUnverifiedConfirm`: `"Could not verify whether \"{{name}}\" is used by a label. Delete anyway?"`
- `media.deleteInUseConfirm`: same wording with "media file" instead of the bare name? Keep it identical to the CSV wording — the name is already interpolated. Use the CSV strings verbatim.
- `media.deleteUnverifiedConfirm`: same as CSV.

Keep them inside their own sections. Only `en.json` exists; do not add locales.

### 4. Tests

`CsvSection.dom.test.tsx`:
- deleting a table that a label references shows the **in-use** message (assert on
  the confirm call argument or the rendered dialog text), and dismissing keeps
  the record;
- deleting an orphan shows the plain `deleteConfirm`;
- when the scan is incomplete, shows the **unverified** message.

`MediaSection.dom.test.tsx`: the in-use and unverified cases (one each is enough;
reuse the existing delete-test scaffolding).

Prefer asserting through the existing `dialogService` mock/spy shape already used
in those files. If the files render a real confirm dialog, assert its text.

## Constraints

- P1's inventory contract: `reload()` returns `ReferenceInventory | null` where
  the sets are **orphan** ids and `complete` gates destructive actions.
- Do not change `useOrphans`, `referenceScan`, `LabelCard`, `GalleryView`, or any
  store slice.
- No new dependencies. One `en.json` writer (this phase).
- 4-space indent, single quotes.

## Done when

- `bun run test -- src/components/gallery/CsvSection.dom.test.tsx src/components/gallery/MediaSection.dom.test.tsx` passes.
- `node node_modules/typescript/bin/tsc --noEmit` is clean.
- Receipt lists files + commands + results.

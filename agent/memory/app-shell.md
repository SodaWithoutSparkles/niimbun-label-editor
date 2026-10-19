# App shell — URL routing, gallery previews, canvas panning

P13b (2026-10-17). Read before touching `urlSync`, the gallery card art, the thumbnail
pipeline, or the canvas pan/zoom input paths.

## Hash routing (P13b `cac5005`)

No router dependency. The address is the app state:

| Address | Meaning |
| --- | --- |
| `#/gallery` | gallery, default section (canonical form — never `#/gallery/recent`) |
| `#/gallery/<recent\|paper\|templates\|csv\|media>` | gallery + section |
| `#/editor?doc=<meta.id>` | editor, label id in the query. **Documents have no tag field** — `meta.id` is the only identifier |
| `#settings` | settings modal open (exclusive: it replaces the rest of the address) |

- **Two files, split by layer** (`code-organization.md`): `src/utils/urlHash.ts` = pure
  `parseHash`/`buildHash` (total on malformed input; `URLSearchParams` decodes once — never
  `decodeURIComponent` the doc id again) and `src/components/layout/useUrlSync.ts` = the hook,
  mounted from `App.tsx`.
- **Direction:** always through the store's own actions (`setView`, `openLabel`, `openSettings`/
  `closeSettings`, `setGallerySection`) — never a raw field write, because `setView` flushes the
  pending autosave and closes the print dialog.
- **Guards:** a `lastWritten` echo token (a write that reproduces it is skipped; a `hashchange`
  equal to it is our own echo) plus a **monotonic apply generation** — a superseded in-flight
  `openLabel` bails after its await, so a slow doc open cannot resurrect an address the user has
  already navigated away from. Unknown/deleted id → land in the gallery and correct the address
  in place with `replaceState` (no back-button ping-pong).
- **History discipline:** boot with no hash writes nothing; `#settings` pushes on open and
  `replaceState`s on close (repeated cycles do not accumulate entries); switching documents while
  the print dialog is open closes it first.
- **Persistence:** `view`/`gallerySection` stay **unpersisted** (`useStore.partialize`) — a reload
  with no hash must land in the gallery.

## Gallery card art (D-50 closed by P3 of the 2026-10-19 run)

- **Colour, not quantized.** `src/editor/render/docThumbnail.ts` → `renderDocPreview(doc, assets?,
  ctx?)` calls the shared prelude `renderPageBase` (extracted from `renderLabelPage`) at 100 dpi,
  applies the **region clip**, then draws the raster — it deliberately skips mask build,
  quantization and the print-only overrides (invert/mirror/offset). It returns **two independent
  outputs**: `blob` = the 100-dpi PNG for the `thumbs` IDB store, and `metaThumb` =
  `{mediaType, dataUrl, at}` downscaled to the `validate.ts` caps (≤512 px longest side, ≤64 KB
  decoded; PNG → JPEG q0.85 → halve down to 128 px, else `undefined`). `THUMB_MAX_SIDE` /
  `THUMB_MAX_BYTES` are exported from `validate.ts` so producer and validator cannot drift.
- Driven by `src/components/editor/useDocThumbnail.ts` (app-wide from `App.tsx`): 1 s debounce,
  per-doc monotonic token, writes the blob via `labelRepo.putThumb` **and** patches
  `doc.meta.thumb` via the history-free `setDocThumb` (no undo entry; schedules autosave). The two
  writes are independent (one failing never discards the other) and the patch no-ops on an
  identical `dataUrl` — that `dataUrl` comparison is what stops the render → patch → render loop
  (the patch changes `currentDoc` identity by design).
- `labelRepo` resolves `LabelSummary.thumb` from the `thumbs` store first, then
  `meta.thumb.dataUrl`; `LabelCard` renders it; `PlaceholderArt` only when both are absent.
- **D-50 backfill:** `src/components/gallery/useThumbBackfill.ts` (mounted in `GalleryView`) fills
  labels with **no** thumb — bounded to 8 per gallery visit in chunks of 2 with idle gaps, a
  module-level attempted-id set (StrictMode/remount-safe), one `refreshGallery` per successful
  batch. It re-checks cancellation before every write and does a **fresh `labelRepo.get` right
  before `save`**, patching only `meta.thumb`, so an edit saved during the render is never
  clobbered; a label deleted mid-render has its orphan thumb row removed.
- **Deliberate:** stale thumbs are displayed as-is (owner decision 6) — no invalidation sweep, and
  no quantized path exists in the gallery. `store/` must not import a renderer; the hooks live in
  `components/` by design.

## Canvas panning input (P13b, D-36 closed)

- Wheel pan is a **native `{ passive: false }` listener** on the Konva container (`stageReady`
  effect in `PreviewStage.tsx`) — the stage's `onWheel` *used to be* react-konva's Konva-event
  binding; the guarantee is now local and regression-tested (one listener across re-renders and
  StrictMode, an effective `preventDefault`, one pan per gesture).
- Panning is available three ways: **middle-button drag**, the **pan tool** (view icon section,
  `'pan'` in the tool vocabulary but deliberately NOT in `INSERT_ACTIONS`), and **space+drag**
  (transient: a local override, `activeTool` is never written, `blur`/keyup/all guards release it).
- **D-36 is closed as upstream behaviour**, not an app bug: touchpad two-finger pan rails to
  cardinal after enough distance along one axis (a diagonal start stays free) — the owner verified
  the same rail on other zoomed-in websites, Chromium never rewrites the deltas JS receives, and the
  Windows precision-touchpad lock is driver-level. See the D-36 row in `tech-debt.md`.

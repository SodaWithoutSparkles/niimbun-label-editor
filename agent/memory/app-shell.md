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

## Gallery card art (D-50, P13b `e75c596`)

- Producer: `src/editor/render/docThumbnail.ts` (`renderDocThumbnail(doc, assets?, ctx?)`, the
  shared `renderLabelPage` at 100 dpi, **repo-backed providers** — without `assets` a local image or
  imported font renders *nothing*), driven by `src/components/editor/useDocThumbnail.ts`, mounted
  app-wide from `App.tsx`.
- The hook debounces on `currentDoc` (1 s, coalesced), guards with a **per-doc monotonic token** so a
  slow older render cannot overwrite a newer thumbnail, writes `labelRepo.putThumb` (never returns a
  rejection), marks dirty, and refreshes the gallery **once on the editor → gallery transition**
  (a per-write `refreshGallery` would be a full-library read roughly every second while editing).
- `labelRepo` resolves `LabelSummary.thumb` from the `thumbs` store to a **data URL string**, so
  `LabelCard` uses it directly; the geometry `PlaceholderArt` stays for labels without one.
- **`store/` must not import a renderer** — the hook lives in `components/` by design.
- Residual: no backfill (a label never reopened/edited keeps its placeholder) and `meta.thumb` is
  never written.

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

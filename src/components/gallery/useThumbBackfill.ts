import { useEffect, useMemo, useRef } from 'react';
import type { LabelDoc } from '../../core/doc/types';
import type { LabelRepo } from '../../data/labelRepo';
import type { AssetDeps } from '../../editor/render/assets';
import { renderDocPreview } from '../../editor/render/docThumbnail';
import { useStore } from '../../store/useStore';
import { createResourceAssetProviders } from '../editor/usePreparedAssets';

/**
 * D-50 wave 2 — backfill thumbnails for labels that have none.
 *
 * `useDocThumbnail` only covers the **open** document. A label saved before the
 * colour producer existed (or one whose `thumbs`/`meta.thumb` write failed) is
 * never reopened, so its gallery card stays blank forever. This hook fills that
 * gap the next time the gallery is visible.
 *
 * **Why the components layer.** The work needs a renderer (`renderDocPreview`),
 * and the store must not import one (`code-organization.md` — dependencies flow
 * one way; `store/` sits below `editor/`). This hook owns the trigger/limit/
 * write policy; the pure producer stays in `editor/render/docThumbnail.ts`.
 *
 * **Why bounded.** `renderDocPreview` rasterizes a full page per label. A
 * whole-library sweep on every gallery visit is exactly the unbounded work that
 * makes entering the gallery janky. We therefore take at most
 * {@link BACKFILL_BATCH_SIZE} labels per visit, render them in chunks of
 * {@link BACKFILL_CHUNK_SIZE} with an idle gap (`requestIdleCallback`, with a
 * `setTimeout` fallback), and stop as soon as the gallery is left. Remaining
 * labels are picked up by a later visit.
 *
 * **Why no invalidation sweep (owner decision).** An existing thumbnail is
 * deliberately left alone, even if it is an old quantized render: the gallery
 * shows whatever was saved until the label is reopened. There is no marker
 * field and no staleness check; the worklist is simply "summaries with no
 * `thumb`" (`LabelSummary.thumb` is absent when both the `thumbs` store and
 * `meta.thumb` are empty).
 *
 * **Once-guard.** {@link attemptedIds} is module-level, so StrictMode effect
 * replay and a remount within the session cannot retry an id that was already
 * attempted (successfully or not). It is never cleared on unmount: an id that
 * failed this session is not hammered on every visit. A module-level token
 * invalidates a superseded run so an old visit cannot keep working after a new
 * one starts.
 *
 * **Non-fatal.** Every item is isolated: a missing doc, a failed render, a
 * rejected `putThumb`/`save` is skipped and the next item proceeds. A batch
 * refreshes the gallery **once**, after it is done, and only when at least one
 * write succeeded.
 */

/** Labels attempted per gallery visit. */
export const BACKFILL_BATCH_SIZE = 8;

/** Labels rendered per idle callback (yields between chunks). */
export const BACKFILL_CHUNK_SIZE = 2;

/**
 * Fallback idle gap when `requestIdleCallback` is unavailable. One frame, so a
 * chunk never runs back-to-back with the previous one on the main thread.
 */
export const IDLE_FALLBACK_MS = 16;

/** Ids already attempted this session (never retried, never cleared). */
const attemptedIds = new Set<string>();

/**
 * Monotonic batch token. A newer batch invalidates the chunk loop of an older
 * one (e.g. a StrictMode replay or a remount that raced the previous run).
 */
let sessionToken = 0;

/** Schedule `run` for idle time; resolve to a canceller. */
const scheduleIdle = (run: () => void): (() => void) => {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        const handle = window.requestIdleCallback(run, { timeout: 1000 });
        return () => window.cancelIdleCallback(handle);
    }
    const handle = setTimeout(run, IDLE_FALLBACK_MS);
    return () => clearTimeout(handle);
};

/**
 * Write both saved-preview outputs for one label.
 *
 * Write order (the record is a whole-record replace, so this matters):
 *   1. read the doc, render (slow), then **re-check `current`** — a cancelled
 *      run or a superseded token writes nothing at all;
 *   2. `putThumb` (its own try/catch, so a later failure cannot undo it);
 *   3. **fresh `get` immediately before `save`** and patch only `meta.thumb` on
 *      that fresh doc — anything saved while the render ran is preserved. No
 *      render happens between the fresh read and the save;
 *   4. re-check `current` after the fresh read, then `save` (its own try/catch).
 *      If the fresh read is `null` the label was deleted during the render: skip
 *      the save and best-effort `removeThumb` so the blob written in step 2 does
 *      not survive it as an orphan row.
 *
 * Returns whether ANY output was written, so the caller can refresh once.
 * Failures never reject; each output is isolated.
 */
const backfillOne = async (
    id: string,
    repo: LabelRepo,
    assets: AssetDeps,
    current: () => boolean,
): Promise<boolean> => {
    const doc = await repo.get(id);
    if (!current()) return false;
    if (!doc) return false;

    const preview = await renderDocPreview(doc, assets);
    // The render is the long part: a cancel or a newer batch landing during it
    // must produce no writes at all.
    if (!current()) return false;
    if (!preview) return false;

    let wroteAny = false;

    if (preview.blob) {
        try {
            if (!current()) return wroteAny;
            await repo.putThumb(id, preview.blob);
            wroteAny = true;
        } catch {
            // The blob output failed; the meta.thumb output may still succeed.
        }
    }

    if (preview.metaThumb) {
        try {
            if (!current()) return wroteAny;
            // Closed labels have no in-memory doc: this repo write is the only
            // one. Re-read now (no render in between) so a save that landed
            // while the preview rendered is not clobbered by a whole-record
            // replace of the pre-render doc.
            const fresh = await repo.get(id);
            if (!current()) return wroteAny;
            if (!fresh) {
                // The label was deleted while the render ran, so its `remove()`
                // already ran `removeThumb` before our late `putThumb` landed.
                // Best-effort cleanup so that write does not leave an orphan
                // `thumbs` row behind (never fatal).
                void repo.removeThumb(id).catch(() => undefined);
                return wroteAny;
            }
            const patched: LabelDoc = {
                ...fresh,
                meta: { ...fresh.meta, thumb: preview.metaThumb },
            };
            await repo.save(patched);
            wroteAny = true;
        } catch {
            // A failed meta.thumb save must not undo the blob write.
        }
    }

    return wroteAny;
};

/** Backfill missing gallery thumbnails, bounded per gallery visit. */
export const useThumbBackfill = (): void => {
    const gallery = useStore((state) => state.gallery);
    const view = useStore((state) => state.view);
    const labelRepo = useStore((state) => state.labelRepo);
    const resourceRepo = useStore((state) => state.resourceRepo);
    const refreshGallery = useStore((state) => state.refreshGallery);

    // Memoized on the repo alone, as in `usePreparedAssets`: a fresh provider
    // identity per render would bypass the decode cache and re-register fonts.
    const assets = useMemo(() => createResourceAssetProviders(resourceRepo), [resourceRepo]);

    // One batch per mounted visit. Set when the first chunk actually starts
    // (not when it is scheduled), so StrictMode's setup → cleanup → setup
    // replay can schedule the batch again without losing it.
    const startedRef = useRef(false);
    // Canceller of the run that currently owns the batch.
    const cancelRunRef = useRef<(() => void) | null>(null);

    // Leaving the gallery stops the loop. The hook normally unmounts with
    // `GalleryView`, so the unmount cleanup below is the main path; this also
    // covers a caller that keeps the hook mounted.
    useEffect(() => {
        if (view === 'gallery') return;
        cancelRunRef.current?.();
        cancelRunRef.current = null;
    }, [view]);

    // Unmount (or StrictMode's simulated one) cancels the pending idle work.
    // The attempted set is intentionally NOT cleared: a failed id must not be
    // retried for the rest of the session.
    useEffect(() => {
        return () => {
            cancelRunRef.current?.();
            cancelRunRef.current = null;
        };
    }, []);

    // No cleanup on this effect on purpose: a gallery update (e.g. another
    // refresh while this batch runs) re-runs it, and cancelling here would stall
    // a batch that `startedRef` then refuses to restart. Lifecycle cleanup is
    // owned by the two effects above; token invalidation handles a
    // StrictMode/Suspense replay that starts a newer batch.
    useEffect(() => {
        if (view !== 'gallery' || !labelRepo || startedRef.current) return;

        // Free worklist: a missing `thumb` means both stores are empty.
        const worklist = gallery
            .filter((summary) => !summary.thumb && !attemptedIds.has(summary.id))
            .slice(0, BACKFILL_BATCH_SIZE)
            .map((summary) => summary.id);
        if (worklist.length === 0) return;

        const token = ++sessionToken;
        let cancelled = false;
        let idleCancel: (() => void) | null = null;
        let cursor = 0;
        let wroteAny = false;

        const current = (): boolean => !cancelled && token === sessionToken;

        const cancelRun = (): void => {
            cancelled = true;
            idleCancel?.();
            idleCancel = null;
        };

        const run = (): void => {
            if (!current()) return;
            startedRef.current = true;
            void (async () => {
                let done = 0;
                while (done < BACKFILL_CHUNK_SIZE && cursor < worklist.length) {
                    const id = worklist[cursor++]!;
                    done += 1;
                    // Marked before the first await: a StrictMode replay or a
                    // racing mount can never pick the same id up twice.
                    if (attemptedIds.has(id)) continue;
                    attemptedIds.add(id);
                    try {
                        if (await backfillOne(id, labelRepo, assets, current)) wroteAny = true;
                    } catch {
                        // Non-fatal backstop; `backfillOne` isolates each write.
                    }
                    if (!current()) return;
                }
                if (!current()) return;
                if (cursor < worklist.length) {
                    idleCancel = scheduleIdle(run);
                    return;
                }
                if (cancelRunRef.current === cancelRun) cancelRunRef.current = null;
                // One read per batch, and only when at least one output (blob or
                // meta.thumb) was actually written.
                if (wroteAny) {
                    try {
                        await refreshGallery();
                    } catch {
                        // `refreshGallery` owns its error surface.
                    }
                }
            })();
        };

        cancelRunRef.current = cancelRun;
        idleCancel = scheduleIdle(run);
    }, [view, gallery, labelRepo, assets, refreshGallery]);
};

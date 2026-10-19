import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { LabelDoc } from '../../core/doc/types';
import { useStore } from '../../store/useStore';
import { renderDocPreview } from '../../editor/render/docThumbnail';
import { createResourceAssetDeps } from './usePreparedAssets';

/**
 * D-50 — write the gallery card preview on document changes.
 *
 * Mounted once for the app's lifetime (`App.tsx`, beside `useUrlSync`). Watches
 * `currentDoc` and, after a short idle debounce, renders a small PNG thumbnail
 * through the colour preview producer (`renderDocPreview` → `renderPageBase`)
 * and writes both outputs: its PNG `blob` via `labelRepo.putThumb`, and its
 * downscaled `metaThumb` via the history-free `setDocThumb` store action (the
 * gallery fallback when the `thumbs` store is missing). Because the trigger is
 * the **document**, it fires regardless of how the doc changed — autosave on or off,
 * explicit save or not — so it covers the cases a `saveDoc`-only save-hook could
 * not.
 *
 * Why a components-layer hook and not a store save-hook: the store must not
 * import a renderer (`code-organization.md` — dependencies flow one way;
 * `store/` sits below `editor/`). The pure producer lives in
 * `editor/render/docThumbnail.ts`; this file owns the debounce/trigger/write.
 *
 * Refresh strategy: a successful write only marks a **dirty** flag — it does NOT
 * read the gallery. `refreshGallery` is a full-library read (`listDetailed()` +
 * a thumb resolve per label), so calling it per completed thumbnail would read
 * the whole library roughly once a second while editing (the debounce bounds
 * frequency, not cost). Instead we refresh **once on the editor → gallery
 * transition**, after flushing and awaiting the pending write, then clear the
 * flag. Making the write land first is what makes the single refresh see it.
 *
 * Guarantees:
 * - **Debounced / coalesced.** A burst of drag/typing frames (each mints a new
 *   `currentDoc`) resets one timer, so only the last doc in the burst renders.
 * - **Per-doc monotonic token.** A newer render for a doc invalidates an older
 *   in-flight one, so a slow older render can never overwrite a newer thumbnail.
 * - **Flush on doc switch.** Leaving a document flushes its pending render
 *   immediately, so the outgoing doc still gets a thumbnail.
 * - **Cheap refresh.** The gallery is read at most once per editor → gallery
 *   transition, only when a thumbnail was written, and only after that write
 *   settles.
 * - **Non-fatal & inert.** No open doc or no `labelRepo` ⇒ nothing happens; a
 *   failed render / `putThumb` / refresh is swallowed and never rejects.
 * - **StrictMode-safe.** The debounce cleanup clears the timer without rendering,
 *   and the doc-id change detector is idempotent, so a double mount neither
 *   double-renders nor leaks the timer.
 *
 * Residual (recorded on D-50): labels never reopened keep their old/no
 * thumbnail — there is no idle/backfill regeneration.
 */

/**
 * Idle delay after the last document change before rendering. Long enough to
 * coalesce an editing burst (drag/typing), mirroring the autosave debounce.
 */
export const DOC_THUMBNAIL_DEBOUNCE_MS = 1000;

export const useDocThumbnail = (): void => {
    const doc = useStore((state) => state.currentDoc);
    const view = useStore((state) => state.view);
    const labelRepo = useStore((state) => state.labelRepo);
    const resourceRepo = useStore((state) => state.resourceRepo);
    const refreshGallery = useStore((state) => state.refreshGallery);
    const setDocThumb = useStore((state) => state.setDocThumb);

    // Repo-backed bytes/fonts, memoized on the repo alone (see
    // `usePreparedAssets`): a new identity per render would bypass the decode
    // cache and re-register every imported font.
    const assets = useMemo(() => createResourceAssetDeps(resourceRepo), [resourceRepo]);

    // Latest inputs, read at call time so the debounce/timer identity is stable
    // across renders (a fresh closure must not rebuild the timer).
    const labelRepoRef = useRef(labelRepo);
    labelRepoRef.current = labelRepo;
    const assetsRef = useRef(assets);
    assetsRef.current = assets;
    const refreshRef = useRef(refreshGallery);
    refreshRef.current = refreshGallery;
    const setDocThumbRef = useRef(setDocThumb);
    setDocThumbRef.current = setDocThumb;

    // Per-doc monotonic render tokens: only the newest render for a doc writes.
    const tokensRef = useRef(new Map<string, number>());
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The doc captured when the pending render was last scheduled (not read when
    // the timer fires, so a later switch cannot swap the doc being rendered).
    const pendingRef = useRef<LabelDoc | null>(null);
    const prevIdRef = useRef<string | null>(null);
    // The last started render+write chain, awaited by the transition flush.
    const inFlightRef = useRef<Promise<void>>(Promise.resolve());
    // A thumbnail was written since the last gallery refresh.
    const dirtyRef = useRef(false);

    /**
     * Render `target` and write it if this is still the newest attempt for its
     * doc. Resolves when the write has settled (so a caller can order a refresh
     * after it). Never rejects.
     */
    const renderAndWrite = useCallback((target: LabelDoc): Promise<void> => {
        const repo = labelRepoRef.current;
        if (!repo) return Promise.resolve();
        const docId = target.meta.id;
        const token = (tokensRef.current.get(docId) ?? 0) + 1;
        tokensRef.current.set(docId, token);
        return renderDocPreview(target, assetsRef.current, {})
            .then(async (preview) => {
                const metaThumb = preview?.metaThumb;
                // The two outputs are independent: the in-memory fallback must
                // not depend on the IDB blob (a failed encode/put must not drop
                // it). Re-check the token immediately before committing, and
                // compare only the `dataUrl` — `at` changes on every render.
                // The patch changes `currentDoc` identity, so the debounce runs
                // once more; that render produces the same `dataUrl` and
                // therefore does NOT patch again (no render/patch loop).
                if (
                    metaThumb &&
                    tokensRef.current.get(docId) === token &&
                    target.meta.thumb?.dataUrl !== metaThumb.dataUrl
                ) {
                    // Mark dirty only when the action actually changed the doc.
                    // `setDocThumb` no-ops when the image is already present (or
                    // another doc is open); an unchanged thumb must not trigger
                    // a full-library `refreshGallery`. Capture the previous
                    // `dataUrl` and confirm the store now carries the produced
                    // one — a genuine change on both sides of the call.
                    const before = useStore.getState().currentDoc?.meta.thumb?.dataUrl;
                    setDocThumbRef.current(docId, metaThumb);
                    const after = useStore.getState().currentDoc?.meta.thumb?.dataUrl;
                    if (after === metaThumb.dataUrl && before !== metaThumb.dataUrl) {
                        dirtyRef.current = true;
                    }
                }

                const blob = preview?.blob ?? null;
                // `null` = unrenderable/no encoder; a bumped token = a newer
                // render superseded this one. In both cases skip the blob; the
                // patch above (if any) still stands.
                if (blob === null || tokensRef.current.get(docId) !== token) return undefined;
                try {
                    await repo.putThumb(docId, blob);
                    dirtyRef.current = true;
                } catch {
                    // Non-fatal and isolated: a failed IDB write must not undo
                    // or reject the successful `meta.thumb` patch above.
                }
                return undefined;
            })
            .catch(() => undefined);
    }, []);

    /** Start a render+write, tracking it as the latest in-flight chain. */
    const start = useCallback(
        (target: LabelDoc): void => {
            inFlightRef.current = renderAndWrite(target);
        },
        [renderAndWrite],
    );

    /** Fire the pending render (timer callback). */
    const fire = useCallback((): void => {
        timerRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) start(pending);
    }, [start]);

    /**
     * Cancel the debounce and render whatever is pending right now, returning the
     * in-flight chain so a caller can await the write. Used by the transition
     * flush and the doc-switch flush.
     */
    const flushPending = useCallback((): Promise<void> => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) start(pending);
        return inFlightRef.current;
    }, [start]);

    // Flush the outgoing document when the open doc changes, so switching away
    // still writes the doc we are leaving (it will never be rendered again).
    // Declared BEFORE the scheduling effect: React runs effect bodies in
    // declaration order, so this reads the previous pending doc before the
    // scheduling effect overwrites it with the new one.
    useEffect(() => {
        const id = doc?.meta.id ?? null;
        if (id === prevIdRef.current) return;
        prevIdRef.current = id;
        if (!pendingRef.current) return;
        void flushPending();
    }, [doc?.meta.id, flushPending]);

    // Coalesce document changes into one debounced render. The cleanup only
    // clears the timer (never renders), so StrictMode's setup → cleanup → setup
    // replay leaves exactly one pending timer.
    useEffect(() => {
        if (!doc) return;
        pendingRef.current = doc;
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(fire, DOC_THUMBNAIL_DEBOUNCE_MS);
        return () => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [doc, fire]);

    // Editor → gallery transition: flush the pending write, await it, then read
    // the gallery ONCE (only if a thumbnail was actually written since the last
    // refresh). Awaiting before refreshing is what makes the single read observe
    // the new thumbnail.
    useEffect(() => {
        if (view !== 'gallery') return;
        let cancelled = false;
        void (async () => {
            await flushPending();
            if (cancelled || !dirtyRef.current) return;
            await refreshRef.current();
            // Clear only AFTER the refresh settles. A future `refreshGallery`
            // that rejected must leave the flag set so the next transition
            // retries the read instead of silently dropping it — the store's
            // version swallows its own errors today, but the hook must not rely
            // on that. (A rejection is caught below, so the flag survives.)
            dirtyRef.current = false;
        })().catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [view, flushPending]);
};

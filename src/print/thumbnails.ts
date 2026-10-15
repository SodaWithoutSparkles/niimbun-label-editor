/**
 * W4 — pure thumbnail cache / render queue.
 *
 * Backs the print dialog's virtualized page list: a small LRU of rendered row
 * thumbnails (default 32) plus a bounded render queue (default 2 concurrent
 * renders), so a large CSV never rasterizes every page (invariant 9) and the
 * interactive rows are rendered before the off-screen prefetch warming.
 *
 * Deliberately React/DOM/Konva-free (decision 42): the caller supplies the
 * `render(rowIndex)` callback (typically wrapping `renderLabelPage` at ~100 dpi);
 * this module only schedules, de-duplicates and caches the resulting handle
 * (a data URL or any opaque string). The React hook `usePrintThumbnails` wraps
 * this cache.
 *
 * Scheduling model:
 * - **LRU** — a `Map` keyed by `rowIndex` in recency order; a cache hit refreshes
 *   recency, and storing past `capacity` evicts the least-recently-used entry.
 * - **Bounded concurrency** — at most `concurrency` `render` calls run at once.
 *   Extra requests wait in a queue.
 * - **FIFO + get priority** — `get` requests drain FIFO (matching an interactive
 *   list); best-effort `prefetch` warming sits behind them so warming never
 *   delays a visible row. Within one `prefetch` call rows are queued nearest
 *   centre first (ties go to the lower index). A `get` for a row a `prefetch`
 *   already queued **promotes** that request to interactive priority, so a
 *   visible row never drains behind the rest of a warming window.
 * - **Superseded warming** — each `prefetch` drops queued-but-unstarted
 *   prefetch requests whose row is outside the new window (and
 *   {@link ThumbnailCache.evict} drops a queued prefetch for that row), so fast
 *   scrolling does not rasterize every row passed. In-flight renders and `get`
 *   requests are never dropped.
 * - **In-flight dedupe** — one request per `rowIndex` at a time: concurrent
 *   `get`s for the same row share a single promise and a single render. A row is
 *   never rendered twice concurrently.
 * - **No poisoning** — a `render` rejection rejects only that row's promise and
 *   removes the in-flight entry, so a later `get` retries.
 * - **No re-entrant drain** — a synchronously-throwing `render` is handled by a
 *   `draining` guard, so draining the queue is iterative and never grows the
 *   stack.
 *
 * Disposal contract (documented choice): {@link ThumbnailCache.dispose} **rejects**
 * every queued and in-flight request with a {@link ThumbnailCacheDisposedError},
 * rejects any later `get`, and prevents late-arriving render results from being
 * cached. `clear()` only empties cached values; use `dispose()` to stop work.
 */

export interface ThumbnailCacheOptions {
    /** Render one row's thumbnail to a data URL (or any opaque handle). */
    render: (rowIndex: number) => Promise<string>;
    /** Max cached entries. Default 32. `0` is a supported no-cache mode. */
    capacity?: number;
    /** Max concurrent renders. Default 2. */
    concurrency?: number;
}

export interface ThumbnailCache {
    /** Resolve a row's thumbnail, rendering it if not cached (dedupes in-flight). */
    get(rowIndex: number): Promise<string>;
    /**
     * Best-effort: warm the window `[center-radius, center+radius]`, nearest first.
     * Negative rows are ignored (the caller owns any upper bound). Replaces the
     * previous warming window by dropping queued superseded prefetches.
     */
    prefetch(center: number, radius: number): void;
    /** Drop one entry / everything. */
    evict(rowIndex: number): void;
    clear(): void;
    /** Abort in-flight work and stop accepting new requests. */
    dispose(): void;
    /** Test/introspection only. */
    readonly size: number;
}

/** Default maximum number of cached thumbnails (owner decision O2: ~32). */
export const DEFAULT_THUMBNAIL_CAPACITY = 32;
/** Default maximum concurrent thumbnail renders (owner decision O2: 2). */
export const DEFAULT_THUMBNAIL_CONCURRENCY = 2;

/** Rejection raised for requests queued/in-flight/issued after {@link ThumbnailCache.dispose}. */
export class ThumbnailCacheDisposedError extends Error {
    constructor() {
        super('ThumbnailCache has been disposed');
        this.name = 'ThumbnailCacheDisposedError';
    }
}

/** Priority 0 = interactive `get`, 1 = best-effort `prefetch`. Lower drains first. */
const PRIORITY_GET = 0;
const PRIORITY_PREFETCH = 1;

interface ThumbnailRequest {
    readonly rowIndex: number;
    /** Mutable: a `get` for an already-queued prefetch promotes it to GET priority. */
    priority: number;
    readonly promise: Promise<string>;
    readonly resolve: (value: string) => void;
    readonly reject: (reason: unknown) => void;
    /** Set once the request is settled (resolved, rejected or disposed). */
    settled: boolean;
}

/** Coerce an option to an integer at or above `min`, falling back to `fallback`. */
const normalizeInt = (value: number | undefined, fallback: number, min: number): number => {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.floor(value));
};

export function createThumbnailCache(opts: ThumbnailCacheOptions): ThumbnailCache {
    const render = opts.render;
    const capacity = normalizeInt(opts.capacity, DEFAULT_THUMBNAIL_CAPACITY, 0);
    const concurrency = normalizeInt(opts.concurrency, DEFAULT_THUMBNAIL_CONCURRENCY, 1);

    /** rowIndex → rendered handle, in recency order (oldest first). */
    const cache = new Map<number, string>();
    /** rowIndex → the single queued or in-flight request for that row. */
    const requests = new Map<number, ThumbnailRequest>();
    /** Requests waiting for a render slot. */
    const queue: ThumbnailRequest[] = [];
    let active = 0;
    let disposed = false;
    /** Re-entrancy guard: `drain` is iterative, never recursive. */
    let draining = false;

    /** Look a cached value up and move it to the most-recent end. */
    const touch = (rowIndex: number): string => {
        const value = cache.get(rowIndex) as string;
        cache.delete(rowIndex);
        cache.set(rowIndex, value);
        return value;
    };

    /** Store a rendered value, evicting the least-recently-used entries over capacity. */
    const store = (rowIndex: number, value: string): void => {
        if (capacity <= 0) return;
        cache.delete(rowIndex);
        cache.set(rowIndex, value);
        while (cache.size > capacity) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
        }
    };

    const makeRequest = (rowIndex: number, priority: number): ThumbnailRequest => {
        let resolve!: (value: string) => void;
        let reject!: (reason: unknown) => void;
        const promise = new Promise<string>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { rowIndex, priority, promise, resolve, reject, settled: false };
    };

    /**
     * Drop a queued (not-yet-started) request: reject it and forget it. Does not
     * touch `active` because a queued request never occupied a render slot.
     */
    const dropRequest = (request: ThumbnailRequest, reason: unknown): void => {
        request.settled = true;
        requests.delete(request.rowIndex);
        request.reject(reason);
    };

    /**
     * Resolve a successful request: cache the value (unless disposed) and resolve.
     * A request already settled by `dispose()` is dropped — its late result is
     * neither cached nor delivered.
     */
    const finishResolve = (request: ThumbnailRequest, value: string): void => {
        active -= 1;
        if (!request.settled) {
            request.settled = true;
            requests.delete(request.rowIndex);
            if (!disposed) store(request.rowIndex, value);
            request.resolve(value);
        }
        drain();
    };

    /** Fail a request: reject, drop the in-flight entry so a later `get` retries. */
    const finishReject = (request: ThumbnailRequest, reason: unknown): void => {
        active -= 1;
        if (!request.settled) {
            request.settled = true;
            requests.delete(request.rowIndex);
            request.reject(reason);
        }
        drain();
    };

    const startRender = (request: ThumbnailRequest): void => {
        active += 1;
        let result: Promise<string>;
        try {
            result = render(request.rowIndex);
        } catch (err) {
            finishReject(request, err);
            return;
        }
        Promise.resolve(result).then(
            (value) => finishResolve(request, value),
            (err) => finishReject(request, err),
        );
    };

    /** Start queued renders while slots are free, honouring priority then FIFO. */
    const drain = (): void => {
        // A synchronously-throwing `render` calls `finishReject` → `drain` from
        // inside the loop below; the guard makes that a no-op so N sync throws
        // stay iterative instead of recursing N deep.
        if (draining) return;
        draining = true;
        try {
            while (active < concurrency && queue.length > 0) {
                let pickIndex = 0;
                for (let i = 1; i < queue.length; i += 1) {
                    if (queue[i].priority < queue[pickIndex].priority) pickIndex = i;
                }
                const [request] = queue.splice(pickIndex, 1);
                startRender(request);
            }
        } finally {
            draining = false;
        }
    };

    const get = (rowIndex: number): Promise<string> => {
        if (disposed) return Promise.reject(new ThumbnailCacheDisposedError());
        if (cache.has(rowIndex)) return Promise.resolve(touch(rowIndex));

        const existing = requests.get(rowIndex);
        if (existing) {
            // Promote a prefetch the caller is now looking at: it must drain
            // ahead of the rest of the warming window.
            existing.priority = PRIORITY_GET;
            return existing.promise;
        }

        const request = makeRequest(rowIndex, PRIORITY_GET);
        requests.set(rowIndex, request);
        queue.push(request);
        drain();
        return request.promise;
    };

    const prefetch = (center: number, radius: number): void => {
        if (disposed) return;
        if (!Number.isFinite(center) || !Number.isFinite(radius)) return;

        const c = Math.trunc(center);
        const r = Math.max(0, Math.trunc(radius));
        const min = c - r;
        const max = c + r;

        // Drop queued (not-yet-started) prefetches the new window supersedes.
        // In-flight renders and promoted `get` requests are kept.
        for (let i = queue.length - 1; i >= 0; i -= 1) {
            const queued = queue[i];
            if (queued.priority !== PRIORITY_PREFETCH) continue;
            if (queued.rowIndex >= min && queued.rowIndex <= max) continue;
            queue.splice(i, 1);
            dropRequest(queued, new Error('thumbnail prefetch superseded by a new window'));
        }

        // Nearest row first; ties resolve to the lower index (lo before hi).
        for (let distance = 0; distance <= r; distance += 1) {
            const lo = c - distance;
            const hi = c + distance;
            for (const rowIndex of lo === hi ? [lo] : [lo, hi]) {
                if (rowIndex < 0) continue;
                if (cache.has(rowIndex) || requests.has(rowIndex)) continue;
                const request = makeRequest(rowIndex, PRIORITY_PREFETCH);
                // Best-effort: never surface a warming failure as unhandled.
                request.promise.catch(() => undefined);
                requests.set(rowIndex, request);
                queue.push(request);
            }
        }
        drain();
    };

    const evict = (rowIndex: number): void => {
        cache.delete(rowIndex);
        // Drop a queued prefetch for the evicted row; never drop a `get`.
        const request = requests.get(rowIndex);
        if (!request || request.settled || request.priority !== PRIORITY_PREFETCH) return;
        const index = queue.indexOf(request);
        if (index === -1) return; // in flight — let it finish
        queue.splice(index, 1);
        dropRequest(request, new Error('thumbnail prefetch evicted'));
    };

    const clear = (): void => {
        cache.clear();
    };

    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        queue.length = 0;
        for (const request of requests.values()) {
            request.settled = true;
            // A fresh instance per rejection: callers must not be able to
            // distinguish/alias each other's errors by identity.
            request.reject(new ThumbnailCacheDisposedError());
        }
        requests.clear();
        // In-flight renders keep running; their finish handlers see `settled`
        // (or `disposed`) and neither cache nor deliver the late result.
    };

    return {
        get,
        prefetch,
        evict,
        clear,
        dispose,
        get size() {
            return cache.size;
        },
    };
}

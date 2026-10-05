import { describe, expect, it } from 'vitest';
import {
    DEFAULT_THUMBNAIL_CAPACITY,
    DEFAULT_THUMBNAIL_CONCURRENCY,
    ThumbnailCacheDisposedError,
    createThumbnailCache,
} from './thumbnails';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

/** Let every pending microtask / timer-free continuation run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A controllable renderer: it records every call, tracks the peak number of
 * simultaneous renders, and hands each row its own deferred so a test can settle
 * rows one at a time.
 */
const createHarness = () => {
    const calls: number[] = [];
    const pending = new Map<number, Deferred<string>>();
    let inFlight = 0;
    let maxInFlight = 0;

    const render = (rowIndex: number): Promise<string> => {
        calls.push(rowIndex);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const slot = deferred<string>();
        pending.set(rowIndex, slot);
        return slot.promise.finally(() => {
            inFlight -= 1;
            pending.delete(rowIndex);
        });
    };

    return {
        render,
        calls,
        get maxInFlight() {
            return maxInFlight;
        },
        settle: (rowIndex: number, value = `thumb-${rowIndex}`) => {
            pending.get(rowIndex)?.resolve(value);
        },
        fail: (rowIndex: number, reason: unknown) => {
            pending.get(rowIndex)?.reject(reason);
        },
    };
};

/** Auto-resolving renderer for tests that only care about which rows rendered. */
const immediateHarness = () => {
    const calls: number[] = [];
    const render = async (rowIndex: number): Promise<string> => {
        calls.push(rowIndex);
        return `thumb-${rowIndex}`;
    };
    return { render, calls };
};

describe('createThumbnailCache — defaults', () => {
    it('exposes LRU-32 / concurrency-2 owner defaults as constants', () => {
        expect(DEFAULT_THUMBNAIL_CAPACITY).toBe(32);
        expect(DEFAULT_THUMBNAIL_CONCURRENCY).toBe(2);
    });

    it('starts empty', () => {
        const cache = createThumbnailCache({ render: async () => 'x' });
        expect(cache.size).toBe(0);
    });
});

describe('createThumbnailCache — LRU capacity', () => {
    it('evicts the least-recently-used entry when over capacity', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({ render: harness.render, capacity: 2 });

        await cache.get(0);
        await cache.get(1);
        await cache.get(2);

        expect(cache.size).toBe(2);
        expect(harness.calls).toEqual([0, 1, 2]);

        // 0 was the oldest and is gone → it renders again; 1 and 2 stay cached.
        await cache.get(0);
        expect(harness.calls).toEqual([0, 1, 2, 0]);

        await cache.get(2);
        expect(harness.calls).toEqual([0, 1, 2, 0]);
    });

    it('refreshes recency on a cache hit', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({ render: harness.render, capacity: 2 });

        await cache.get(0);
        await cache.get(1);
        await cache.get(0); // refresh 0 → 1 is now the oldest
        await cache.get(2); // evicts 1, keeps 0

        expect(cache.size).toBe(2);
        await cache.get(0); // still cached
        expect(harness.calls).toEqual([0, 1, 2]);
        await cache.get(1); // was evicted → renders again
        expect(harness.calls).toEqual([0, 1, 2, 1]);
    });

    it('returns the cached value on a hit without re-rendering', async () => {
        let calls = 0;
        const cache = createThumbnailCache({
            render: async (rowIndex) => {
                calls += 1;
                return `thumb-${rowIndex}`;
            },
            capacity: 4,
        });

        expect(await cache.get(7)).toBe('thumb-7');
        expect(await cache.get(7)).toBe('thumb-7');
        expect(calls).toBe(1);
    });

    it('never caches when capacity is 0', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({ render: harness.render, capacity: 0 });

        expect(await cache.get(0)).toBe('thumb-0');
        expect(await cache.get(0)).toBe('thumb-0');
        expect(cache.size).toBe(0);
        expect(harness.calls).toEqual([0, 0]);
    });
});

describe('createThumbnailCache — concurrency', () => {
    it('runs at most `concurrency` renders at once and queues the rest FIFO', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 2 });

        const promises = [cache.get(0), cache.get(1), cache.get(2), cache.get(3)];
        await flush();

        expect(harness.calls).toEqual([0, 1]);
        expect(harness.maxInFlight).toBe(2);

        harness.settle(0);
        await flush();
        expect(harness.calls).toEqual([0, 1, 2]);

        harness.settle(1);
        await flush();
        expect(harness.calls).toEqual([0, 1, 2, 3]);

        harness.settle(2);
        harness.settle(3);
        await expect(Promise.all(promises)).resolves.toEqual([
            'thumb-0',
            'thumb-1',
            'thumb-2',
            'thumb-3',
        ]);
        expect(harness.maxInFlight).toBe(2);
    });

    it('drains the queue as slots free (concurrency 1)', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        const promises = [cache.get(0), cache.get(1), cache.get(2)];
        await flush();
        expect(harness.calls).toEqual([0]);

        harness.settle(0);
        await flush();
        expect(harness.calls).toEqual([0, 1]);

        harness.settle(1);
        await flush();
        expect(harness.calls).toEqual([0, 1, 2]);

        harness.settle(2);
        await expect(Promise.all(promises)).resolves.toEqual([
            'thumb-0',
            'thumb-1',
            'thumb-2',
        ]);
    });
});

describe('createThumbnailCache — in-flight dedupe', () => {
    it('renders once for two concurrent gets on the same row', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 2 });

        const first = cache.get(5);
        const second = cache.get(5);
        await flush();

        expect(harness.calls).toEqual([5]);

        harness.settle(5, 'shared');
        await expect(Promise.all([first, second])).resolves.toEqual(['shared', 'shared']);
        expect(harness.calls).toEqual([5]);
    });

    it('does not start a second render for a row while its first is in flight', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 3 });

        cache.get(0);
        cache.get(0);
        cache.get(0);
        await flush();

        expect(harness.maxInFlight).toBe(1);
        expect(harness.calls).toEqual([0]);
    });
});

describe('createThumbnailCache — rejection isolation', () => {
    it('rejects the row but does not poison the cache → a later get retries', async () => {
        let attempts = 0;
        const cache = createThumbnailCache({
            render: async (rowIndex) => {
                attempts += 1;
                if (attempts === 1) throw new Error('render boom');
                return `thumb-${rowIndex}`;
            },
            capacity: 4,
        });

        await expect(cache.get(3)).rejects.toThrow('render boom');
        expect(cache.size).toBe(0);

        await expect(cache.get(3)).resolves.toBe('thumb-3');
        expect(cache.size).toBe(1);
        expect(attempts).toBe(2);
    });

    it('keeps other rows intact when one render rejects', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 2 });

        const failing = cache.get(0);
        const good = cache.get(1);
        await flush();

        harness.fail(0, new Error('nope'));
        harness.settle(1, 'ok');

        await expect(failing).rejects.toThrow('nope');
        await expect(good).resolves.toBe('ok');
        expect(cache.size).toBe(1);
    });
});

describe('createThumbnailCache — evict / clear', () => {
    it('evicts a single cached row', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({ render: harness.render, capacity: 4 });

        await cache.get(0);
        await cache.get(1);
        cache.evict(0);

        expect(cache.size).toBe(1);
        await cache.get(0);
        expect(harness.calls).toEqual([0, 1, 0]);
    });

    it('clears every cached row', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({ render: harness.render, capacity: 4 });

        await cache.get(0);
        await cache.get(1);
        cache.clear();

        expect(cache.size).toBe(0);
        await cache.get(0);
        expect(harness.calls).toEqual([0, 1, 0]);
    });

    it('drops a queued prefetch for the evicted row', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        cache.prefetch(1, 3); // starts 1, queues 0,2,3,4
        cache.evict(3); // 3 is queued warming → dropped
        await flush();

        expect(harness.calls).toEqual([1, 0, 2, 4]);
    });

    it('never drops a queued get on evict', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        const first = cache.get(0); // occupies the only slot
        await flush();
        const visible = cache.get(5); // queued interactive get
        cache.evict(5); // must not drop it

        harness.settle(0, 'first');
        await expect(first).resolves.toBe('first');
        await flush();

        expect(harness.calls).toEqual([0, 5]);
        harness.settle(5, 'visible');
        await expect(visible).resolves.toBe('visible');
    });
});

describe('createThumbnailCache — dispose', () => {
    it('rejects in-flight and queued requests, and later gets', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        const inFlight = cache.get(0);
        const queued = cache.get(1);
        await flush();
        expect(harness.calls).toEqual([0]);

        cache.dispose();

        await expect(inFlight).rejects.toBeInstanceOf(ThumbnailCacheDisposedError);
        await expect(queued).rejects.toBeInstanceOf(ThumbnailCacheDisposedError);
        await expect(cache.get(2)).rejects.toBeInstanceOf(ThumbnailCacheDisposedError);

        // The queued row never started.
        expect(harness.calls).toEqual([0]);
    });

    it('does not cache a render that settles after dispose', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        const inFlight = cache.get(0);
        await flush();
        cache.dispose();
        await expect(inFlight).rejects.toBeInstanceOf(ThumbnailCacheDisposedError);

        harness.settle(0, 'late');
        await flush();

        expect(cache.size).toBe(0);
    });

    it('is idempotent', () => {
        const cache = createThumbnailCache({ render: async () => 'x' });
        cache.dispose();
        expect(() => cache.dispose()).not.toThrow();
    });

    it('rejects each disposed request with a fresh error instance', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        const inFlight = cache.get(0);
        const queued = cache.get(1);
        await flush();
        cache.dispose();

        const first = await inFlight.catch((err) => err);
        const second = await queued.catch((err) => err);
        expect(first).toBeInstanceOf(ThumbnailCacheDisposedError);
        expect(second).toBeInstanceOf(ThumbnailCacheDisposedError);
        expect(first).not.toBe(second);
    });
});

describe('createThumbnailCache — re-entrancy', () => {
    it('stays iterative when a synchronously-throwing render drains a large queue', async () => {
        const calls: number[] = [];
        const cache = createThumbnailCache({
            render: (rowIndex) => {
                calls.push(rowIndex);
                throw new Error('sync boom');
            },
            concurrency: 1,
        });

        // 5001 queued prefetches, each throwing synchronously. Without the drain
        // guard this recursed once per row and overflowed the stack.
        expect(() => cache.prefetch(2500, 2500)).not.toThrow();
        await flush();

        expect(calls).toHaveLength(5001);
    });
});

describe('createThumbnailCache — prefetch', () => {
    it('warms the window nearest-first (ties to the lower index)', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        cache.prefetch(5, 2);
        await flush();

        expect(harness.calls).toEqual([5, 4, 6, 3, 7]);
        expect(cache.size).toBe(5);
    });

    it('skips out-of-range rows below 0', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        cache.prefetch(0, 2);
        await flush();

        expect(harness.calls).toEqual([0, 1, 2]);
    });

    it('skips rows already cached or already in flight', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({
            render: harness.render,
            concurrency: 1,
            capacity: 8,
        });

        await cache.get(6);
        expect(harness.calls).toEqual([6]);

        cache.prefetch(5, 2); // window 3..7, 6 already cached
        await flush();

        expect(harness.calls).toEqual([6, 5, 4, 3, 7]);
    });

    it('does not delay an interactive get behind warming', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        const first = cache.get(0); // occupies the only slot
        await flush();
        cache.prefetch(1, 3); // queues 1,2,3,4 as warming
        const visible = cache.get(9); // interactive get jumps the warming queue

        harness.settle(0, 'first');
        await expect(first).resolves.toBe('first');
        await flush();

        // 9 (a `get`) drained before the queued warming rows.
        expect(harness.calls).toEqual([0, 9]);

        harness.settle(9, 'visible');
        await expect(visible).resolves.toBe('visible');
    });

    it('promotes a get for a row prefetch already queued (no starvation)', async () => {
        const harness = createHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        const first = cache.get(0); // occupies the only slot
        await flush();
        cache.prefetch(1, 3); // queues 1,2,3,4 as warming

        // 2 is already queued as a prefetch; the get must promote it rather than
        // return it at its old priority and drain behind the warming window.
        const visible = cache.get(2);

        harness.settle(0, 'first');
        await expect(first).resolves.toBe('first');
        await flush();

        expect(harness.calls).toEqual([0, 2]);

        harness.settle(2, 'visible');
        await expect(visible).resolves.toBe('visible');
    });

    it('drops superseded queued prefetches when the window moves', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        cache.prefetch(1, 2); // window -1..3 → starts 1, queues 0,2,3
        cache.prefetch(10, 2); // window 8..12 → drops queued 0,2,3; keeps in-flight 1
        await flush();

        // Only the new window (plus the already-started row) ever renders, and
        // in nearest-first order (10, then 9/11, then 8/12).
        expect(harness.calls).toEqual([1, 10, 9, 11, 8, 12]);
    });

    it('is a no-op after dispose', async () => {
        const harness = immediateHarness();
        const cache = createThumbnailCache({ render: harness.render, concurrency: 1 });

        cache.dispose();
        cache.prefetch(0, 3);
        await flush();

        expect(harness.calls).toEqual([]);
    });
});

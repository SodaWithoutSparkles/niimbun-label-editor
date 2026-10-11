import { describe, expect, it } from 'vitest';
import type { RemoteGlobalSpec, StaticGlobalSpec } from '../core/doc/types';
import {
    createGlobalsCache,
    createExtract,
    prefetchGlobals,
    type GlobalsResult,
} from './globals';

const spec = (
    overrides: Partial<Omit<RemoteGlobalSpec, 'kind'>> & Pick<RemoteGlobalSpec, 'name'>,
): RemoteGlobalSpec => ({
    kind: 'remote',
    url: `https://example.test/${overrides.name}`,
    extract: 'value',
    expiresAt: 2_000_000_000, // epoch seconds, far in the future for now=0
    ...overrides,
});

const staticSpec = (name: string, value: string): StaticGlobalSpec => ({ kind: 'static', name, value });

const isStructuredCloneable = (value: unknown): boolean => {
    try {
        structuredClone(value);
        return true;
    } catch {
        return false;
    }
};

describe('createExtract', () => {
    it('walks a dotted path over objects and array indices', () => {
        const body = { data: { rate: 4.2 }, items: [{ name: 'Ada' }, { name: 'Grace' }] };
        expect(createExtract('data.rate')(body)).toBe(4.2);
        expect(createExtract('items.0.name')(body)).toBe('Ada');
        expect(createExtract('items.1.name')(body)).toBe('Grace');
    });

    it('falls back when the path is absent, parsing JSON literals', () => {
        const extract = createExtract('data.missing | "n/a"');
        expect(extract({ data: {} })).toBe('n/a');
        expect(createExtract('a.b | 7')({})).toBe(7);
        expect(createExtract('a.b | {"x":1}')({})).toEqual({ x: 1 });
    });

    it('uses the raw string for a non-JSON fallback and undefined for an empty one', () => {
        expect(createExtract('a | hello world')({})).toBe('hello world');
        expect(createExtract('a |')({})).toBeUndefined();
        expect(createExtract('a')({})).toBeUndefined();
    });

    it('does not execute the expression', () => {
        const body = { toString: () => 'boom' };
        // A path merely probes own data descriptors; it never calls anything.
        expect(createExtract('toString')(body)).toBeTypeOf('function');
    });

    it('never runs a getter on the parsed body (data selector, no code)', () => {
        let ran = false;
        const body = {};
        Object.defineProperty(body, 'rate', {
            get() {
                ran = true;
                throw new Error('exec');
            },
        });

        expect(createExtract('rate')(body)).toBeUndefined();
        expect(ran).toBe(false);
        expect(createExtract('rate | 0')(body)).toBe(0);
        expect(ran).toBe(false);
    });

    it('normalizes a leading `$.`, `$`, or single `.` before splitting', () => {
        const body = { rate: 4.2, a: { b: [{ c: 'deep' }] } };
        expect(createExtract('.rate')(body)).toBe(4.2);
        expect(createExtract('$.rate')(body)).toBe(4.2);
        expect(createExtract('$rate')(body)).toBe(4.2);
        expect(createExtract('rate')(body)).toBe(4.2);
        // Dot-numeric array indices keep working, with or without the sugar.
        expect(createExtract('a.b.0.c')(body)).toBe('deep');
        expect(createExtract('$.a.b.0.c')(body)).toBe('deep');
    });

    it('applies the `|` fallback for a missing path, sugar included', () => {
        expect(createExtract('a.b.0.c|fallback')({})).toBe('fallback');
        expect(createExtract('$.missing | "n/a"')({})).toBe('n/a');
        // An empty path (before the pipe) means the whole body, unchanged.
        expect(createExtract('|fallback')({ x: 1 })).toEqual({ x: 1 });
        expect(createExtract('$')({ x: 1 })).toEqual({ x: 1 });
    });
});

describe('prefetchGlobals', () => {
    it('namespaces resolved values under their spec name', async () => {
        const result = await prefetchGlobals(
            [spec({ name: 'rate', extract: 'data.rate' })],
            { now: () => 0, fetchJson: async () => ({ data: { rate: 42 } }) },
        );

        expect(result.warnings).toHaveLength(0);
        expect(result.values).toEqual({ rate: 42 });
    });

    it('returns structured-cloneable values ready to spread into globals', async () => {
        const result = await prefetchGlobals(
            [spec({ name: 'cfg', extract: 'nested' })],
            { now: () => 0, fetchJson: async () => ({ nested: { a: [1, 2, 3], b: 'x' } }) },
        );

        expect(isStructuredCloneable(result.values)).toBe(true);
        expect(isStructuredCloneable(result.values.cfg)).toBe(true);
    });

    it('dedupes identical spec names, keeping the first (one fetch) and warns on the dup', async () => {
        let calls = 0;
        const result = await prefetchGlobals(
            [
                spec({ name: 'dup', extract: 'v' }),
                spec({ name: 'dup', extract: 'other', url: 'https://other.test' }),
            ],
            {
                now: () => 0,
                fetchJson: async () => {
                    calls += 1;
                    return { v: 'first' };
                },
            },
        );

        expect(calls).toBe(1);
        expect(result.values).toEqual({ dup: 'first' });
        expect(result.warnings).toEqual([
            expect.objectContaining({ name: 'dup', kind: 'invalid' }),
        ]);
    });

    it('isolates cache entries keyed by full spec identity (same expiresAt, different url/extract)', async () => {
        const cache = createGlobalsCache();
        const deps = {
            now: () => 0,
            fetchJson: async (url: string) => (url.includes('a.test') ? { v: 'A' } : { v: 'B' }),
        };
        const specs = [
            spec({ name: 'x', url: 'https://a.test/x', extract: 'v', expiresAt: 2_000_000_000 }),
            spec({ name: 'y', url: 'https://b.test/y', extract: 'v', expiresAt: 2_000_000_000 }),
        ];

        const result = await cache.prefetch(specs, deps);
        expect(result.values).toEqual({ x: 'A', y: 'B' });
    });

    it('respects the concurrency cap (high-water mark <= 4)', async () => {
        let inFlight = 0;
        let highWater = 0;
        const specs = Array.from({ length: 10 }, (_unused, index) => spec({ name: `g${index}` }));

        const result = await prefetchGlobals(specs, {
            now: () => 0,
            fetchJson: async () => {
                inFlight += 1;
                highWater = Math.max(highWater, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 1));
                inFlight -= 1;
                return { value: 1 };
            },
        });

        expect(highWater).toBeLessThanOrEqual(4);
        expect(highWater).toBeGreaterThan(1); // actually parallel
        expect(Object.keys(result.values)).toHaveLength(10);
    });

    it('a fetch error warns and never rejects the whole job', async () => {
        const result = await prefetchGlobals(
            [spec({ name: 'ok', extract: 'v' }), spec({ name: 'bad' })],
            {
                now: () => 0,
                fetchJson: async (url) => {
                    if (url.includes('bad')) throw new Error('network down');
                    return { v: 'fine' };
                },
            },
        );

        expect(result.values).toEqual({ ok: 'fine' });
        expect(result.warnings).toEqual([
            expect.objectContaining({ name: 'bad', kind: 'fetch' }),
        ]);
    });

    it('warns on an absent extract path and extracts nothing for it', async () => {
        const result = await prefetchGlobals(
            [spec({ name: 'missing', extract: 'data.nope' })],
            { now: () => 0, fetchJson: async () => ({ data: {} }) },
        );

        expect(result.values).toEqual({});
        expect(result.warnings).toEqual([
            expect.objectContaining({ name: 'missing', kind: 'extract' }),
        ]);
    });

    it('marks an empty extract as invalid without fetching', async () => {
        let calls = 0;
        const result = await prefetchGlobals(
            [spec({ name: 'bad', extract: '   ' })],
            {
                now: () => 0,
                fetchJson: async () => {
                    calls += 1;
                    return {};
                },
            },
        );

        expect(calls).toBe(0);
        expect(result.warnings).toEqual([
            expect.objectContaining({ name: 'bad', kind: 'invalid' }),
        ]);
    });

    it('isolates an uncloneable extracted value to its own spec (never rejects the job)', async () => {
        const result = await prefetchGlobals(
            [spec({ name: 'bad', extract: 'value' }), spec({ name: 'good', extract: 'value' })],
            {
                now: () => 0,
                fetchJson: async (url) =>
                    url.includes('bad') ? { value: new WeakMap() } : { value: 'ok' },
            },
        );

        expect(result.values).toEqual({ good: 'ok' });
        expect(result.warnings).toEqual([
            expect.objectContaining({ name: 'bad', kind: 'invalid' }),
        ]);
    });

    it('rejects an object with a function-valued property without rejecting the job', async () => {
        const result = await prefetchGlobals(
            [spec({ name: 'bad', extract: 'value' }), spec({ name: 'good', extract: 'value' })],
            {
                now: () => 0,
                fetchJson: async (url) =>
                    url.includes('bad') ? { value: { fn: () => 1 } } : { value: 'ok' },
            },
        );

        expect(result.values).toEqual({ good: 'ok' });
        expect(result.warnings).toEqual([
            expect.objectContaining({ name: 'bad', kind: 'invalid' }),
        ]);
    });

    it('returns deep-frozen values (mutation throws in strict mode)', async () => {
        'use strict';
        const result = await prefetchGlobals(
            [spec({ name: 'cfg', extract: 'nested' })],
            { now: () => 0, fetchJson: async () => ({ nested: { a: [1, 2], b: 'x' } }) },
        );

        const cfg = result.values.cfg as { a: number[]; b: string };
        expect(Object.isFrozen(result.values)).toBe(false); // container is ours, values are frozen
        expect(Object.isFrozen(cfg)).toBe(true);
        expect(Object.isFrozen(cfg.a)).toBe(true);
        expect(() => {
            cfg.b = 'y';
        }).toThrow(TypeError);
        expect(() => {
            cfg.a.push(3);
        }).toThrow(TypeError);
    });

    it('resolves a fast sibling while another spec times out, ignoring a post-abort resolution', async () => {
        let lateResolved = false;
        const result = await prefetchGlobals(
            [spec({ name: 'fast', extract: 'v' }), spec({ name: 'slow' })],
            {
                now: () => 0,
                fetchJson: (url, signal) => {
                    if (url.includes('slow')) {
                        return new Promise((resolve, reject) => {
                            signal?.addEventListener('abort', () => {
                                reject(new Error('aborted'));
                                // Resolve after the abort: the race is already
                                // decided, so this must be ignored.
                                queueMicrotask(() => {
                                    lateResolved = true;
                                    resolve({ v: 'too late' });
                                });
                            });
                        });
                    }
                    return Promise.resolve({ v: 'quick' });
                },
            },
        );

        expect(result.values).toEqual({ fast: 'quick' });
        expect(result.warnings).toEqual([
            expect.objectContaining({ name: 'slow', kind: 'timeout' }),
        ]);
        expect(result.values.slow).toBeUndefined();
        expect(lateResolved).toBe(true); // it ran, but never reached the result
    }, 10_000);
});

describe('createGlobalsCache', () => {
    it('serves a valid cache entry without a second fetch', async () => {
        const cache = createGlobalsCache();
        let calls = 0;
        const deps = {
            now: () => 1_000,
            fetchJson: async () => {
                calls += 1;
                return { value: 'cached' };
            },
        };
        const specs = [spec({ name: 'rate', expiresAt: 2_000_000_000 })];

        const first = await cache.prefetch(specs, deps);
        const second = await cache.prefetch(specs, deps);

        expect(calls).toBe(1);
        expect(first.values).toEqual({ rate: 'cached' });
        expect(second.values).toEqual({ rate: 'cached' });
    });

    it('honours the expiresAt boundary: future is cached, past refetches', async () => {
        let nowMs = 1_000_000;
        let calls = 0;
        const cache = createGlobalsCache();
        const deps = {
            now: () => nowMs,
            fetchJson: async () => {
                calls += 1;
                return { value: calls };
            },
        };
        // expiresAt is epoch seconds; now is epoch ms.
        const future = spec({ name: 'future', expiresAt: 2_000 });
        const past = spec({ name: 'past', expiresAt: 500 });

        await cache.prefetch([future, past], deps);
        expect(calls).toBe(2);

        // Both still expired/valid per clock: future valid, past expired.
        nowMs = 1_100_000;
        await cache.prefetch([future, past], deps);
        expect(calls).toBe(3); // only `past` refetched
    });

    it('clear() drops entries so the next prefetch refetches', async () => {
        const cache = createGlobalsCache();
        let calls = 0;
        const deps = {
            now: () => 0,
            fetchJson: async () => {
                calls += 1;
                return { value: calls };
            },
        };
        const specs = [spec({ name: 'x', expiresAt: 2_000_000_000 })];

        await cache.prefetch(specs, deps);
        cache.clear();
        await cache.prefetch(specs, deps);

        expect(calls).toBe(2);
    });

    it('isolates cache state between two job-scoped caches', async () => {
        let calls = 0;
        const deps = {
            now: () => 0,
            fetchJson: async () => {
                calls += 1;
                return { value: 'shared' };
            },
        };
        const specs = [spec({ name: 'x', expiresAt: 2_000_000_000 })];

        const jobA = createGlobalsCache();
        const jobB = createGlobalsCache();
        await jobA.prefetch(specs, deps);
        await jobB.prefetch(specs, deps);

        expect(calls).toBe(2); // job B did not reuse job A's snapshot
    });

    it('treats expiresAt * 1000 === now as expired (strict future only)', async () => {
        let calls = 0;
        const cache = createGlobalsCache();
        const deps = {
            now: () => 1_000,
            fetchJson: async () => {
                calls += 1;
                return { value: calls };
            },
        };
        // expiresAt 1 (epoch s) → 1000 ms === now(1000): expired.
        const boundary = spec({ name: 'b', expiresAt: 1 });

        await cache.prefetch([boundary], deps);
        await cache.prefetch([boundary], deps);

        expect(calls).toBe(2);
    });

    it('shares one in-flight fetch between concurrent prefetches of the same spec', async () => {
        let calls = 0;
        const cache = createGlobalsCache();
        const specs = [spec({ name: 'x', expiresAt: 2_000_000_000 })];
        const deps = {
            now: () => 0,
            fetchJson: async () => {
                calls += 1;
                await new Promise((resolve) => setTimeout(resolve, 10));
                return { value: 'once' };
            },
        };

        const [first, second] = await Promise.all([
            cache.prefetch(specs, deps),
            cache.prefetch(specs, deps),
        ]);

        expect(calls).toBe(1);
        expect(first.values).toEqual({ x: 'once' });
        expect(second.values).toEqual({ x: 'once' });
    });

    it('keys specs whose fields contain the old NUL delimiter unambiguously', async () => {
        const cache = createGlobalsCache();

        // Two static specs whose `name`/`value` contain `\u0000`. A naive
        // NUL-joined key lets `name \0 static \0 value` collide across the
        // field boundary, so one could serve the other's value.
        const statA = staticSpec('a', '\u0000static\u0000b');
        const statB = staticSpec('a\u0000static\u0000', 'b');
        const staticDeps = { now: () => 0, fetchJson: async () => ({}) };

        const statFirst = await cache.prefetch([statA, statB], staticDeps);
        expect(statFirst.values).toEqual({
            a: '\u0000static\u0000b',
            'a\u0000static\u0000': 'b',
        });
        const statSecond = await cache.prefetch([statA, statB], staticDeps);
        expect(statSecond.values).toEqual(statFirst.values);

        // Two remote specs whose `name`/`url` collide under a naive NUL-joined
        // key: `name \0 url \0 extract \0 expiresAt` is byte-identical for both.
        // Counting fetches makes the cache reuse observable.
        let calls = 0;
        const deps = {
            now: () => 0,
            fetchJson: async (url: string) => {
                calls += 1;
                return { value: url, other: `other:${url}` };
            },
        };
        const remoteA = spec({ name: 'r', url: 'remote\u0000b', extract: 'value', expiresAt: 2_000_000_000 });
        const remoteB = spec({ name: 'r\u0000remote', url: 'b', extract: 'value', expiresAt: 2_000_000_000 });

        const remoteFirst = await cache.prefetch([remoteA, remoteB], deps);
        expect(calls).toBe(2); // distinct entries: each fetched its own value
        expect(remoteFirst.values).toEqual({
            r: 'remote\u0000b',
            'r\u0000remote': 'b',
        });

        const remoteSecond = await cache.prefetch([remoteA, remoteB], deps);
        expect(calls).toBe(2); // valid entries reused across prefetches
        expect(remoteSecond.values).toEqual(remoteFirst.values);

        // A colliding-looking-but-different spec (same name and url, different
        // extract) is its own identity and must not reuse a cached value.
        const remoteC = spec({ name: 'r\u0000remote', url: 'b', extract: 'other', expiresAt: 2_000_000_000 });
        const remoteThird = await cache.prefetch([remoteC], deps);
        expect(calls).toBe(3);
        expect(remoteThird.values).toEqual({ 'r\u0000remote': 'other:b' });
    });

    it('an expired entry warns on failure rather than reusing stale data', async () => {
        let nowMs = 1_000_000;
        const cache = createGlobalsCache();
        const specs = [spec({ name: 'x', expiresAt: 1_000 })];
        await cache.prefetch(specs, {
            now: () => nowMs,
            fetchJson: async () => ({ value: 'fresh' }),
        });

        nowMs = 2_000_000; // entry expired
        const result = await cache.prefetch(specs, {
            now: () => nowMs,
            fetchJson: async () => {
                throw new Error('offline');
            },
        });

        expect(result.values).toEqual({});
        expect(result.warnings).toEqual([
            expect.objectContaining({ kind: 'fetch' }),
        ]);
    });
});

describe('prefetchGlobals — static specs', () => {
    it('resolves a static value with no fetch and no warning', async () => {
        let calls = 0;
        const result = await prefetchGlobals(
            [staticSpec('greeting', 'hello')],
            {
                now: () => 0,
                fetchJson: async () => {
                    calls += 1;
                    return {};
                },
            },
        );

        expect(calls).toBe(0); // fetch dep is never called for a static spec
        expect(result.warnings).toEqual([]);
        expect(result.values).toEqual({ greeting: 'hello' });
        expect(isStructuredCloneable(result.values)).toBe(true);
    });

    it('caches a static entry as always-valid (no expiry, never refetched)', async () => {
        let nowMs = 0;
        let calls = 0;
        const cache = createGlobalsCache();
        const deps = {
            now: () => nowMs,
            fetchJson: async () => {
                calls += 1;
                return {};
            },
        };
        const specs = [staticSpec('fixed', 'v')];

        const first = await cache.prefetch(specs, deps);
        nowMs = 10 ** 15; // far future: any remote entry would be long expired
        const second = await cache.prefetch(specs, deps);

        expect(calls).toBe(0);
        expect(first.values).toEqual({ fixed: 'v' });
        expect(second.values).toEqual({ fixed: 'v' });
    });

    it('keeps two different static values with the same name as distinct entries', async () => {
        const cache = createGlobalsCache();
        const deps = { now: () => 0, fetchJson: async () => ({}) };

        const a = await cache.prefetch([staticSpec('k', 'A')], deps);
        const b = await cache.prefetch([staticSpec('k', 'B')], deps);

        expect(a.values).toEqual({ k: 'A' });
        expect(b.values).toEqual({ k: 'B' });
    });

    it('never lets a static spec and a remote spec of the same name collide', async () => {
        const cache = createGlobalsCache();
        let calls = 0;
        const deps = {
            now: () => 0,
            fetchJson: async () => {
                calls += 1;
                return { value: 'remote' };
            },
        };

        const remote = await cache.prefetch([spec({ name: 'k', extract: 'value' })], deps);
        const stat = await cache.prefetch([staticSpec('k', 'literal')], deps);

        expect(calls).toBe(1); // the remote spec fetched once
        expect(remote.values).toEqual({ k: 'remote' });
        expect(stat.values).toEqual({ k: 'literal' });
    });

    it('resolves mixed remote and static specs in one prefetch', async () => {
        const result = await prefetchGlobals(
            [staticSpec('s', 'lit'), spec({ name: 'r', extract: 'value' })],
            { now: () => 0, fetchJson: async () => ({ value: 'fetched' }) },
        );

        expect(result.warnings).toEqual([]);
        expect(result.values).toEqual({ s: 'lit', r: 'fetched' });
    });

    it('an empty static value still yields a value (not absent)', async () => {
        const result = await prefetchGlobals([staticSpec('blank', '')], { now: () => 0 });
        expect(result.values).toEqual({ blank: '' });
    });
});

describe('GlobalsResult shape', () => {
    it('is spreadable into a globals record', async () => {
        const { values }: GlobalsResult = await prefetchGlobals(
            [spec({ name: 'a', extract: 'x' })],
            { now: () => 0, fetchJson: async () => ({ x: 1 }) },
        );
        const globals = { ...values, injected: 2 };
        expect(globals).toEqual({ a: 1, injected: 2 });
    });
});

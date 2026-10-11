/**
 * Globals prefetch — resolve every document `GlobalSpec` **once per job**,
 * then hand the resolved values to the template worker as `globals.<name>`.
 *
 * Owner decision (plan §Templates, decision 33): the **host** owns network
 * egress for globals. Templates never fetch. Each **remote** spec is fetched
 * once per job, the response is run through a non-Turing extractor, the value
 * is returned structured-cloneable, and the job passes `{ ...result.values }`
 * straight into `TemplateContext.globals`. **Static** specs carry a literal
 * value and never fetch. The worker receives a deep clone
 * by `postMessage`; it never sees a fetch, a URL, or a callable.
 *
 * `src/templates/` is the browser edge, so `fetch` is available — but every
 * side effect (fetch + clock) is injectable for offline, deterministic tests.
 *
 * ## Cache model
 *
 * One cache is shared across the whole job and must **not** leak into another
 * job. Build one per job with {@link createGlobalsCache}; the returned
 * `prefetch` reuses a cached value while `expiresAt * 1000 > now`, and
 * `clear()` drops the job's entries. {@link prefetchGlobals} is a one-shot
 * convenience that creates a private cache — call it per job, or use the cache
 * factory when several rows/specs must share results within one job.
 *
 * Entries are keyed by the **full spec identity** (`name`, `kind`, and the
 * kind-specific fields), not by `expiresAt` alone — two specs that share an
 * expiry (or a static spec and a remote one) can never serve each other's
 * value. An in-flight fetch is stored under the same
 * key so concurrent callers of one spec await a single fetch. Boundary: an
 * entry is valid only while `expiresAt * 1000 > now` (strict); at exactly
 * `now` it is expired.
 *
 * Static specs carry no URL and no expiry: their literal `value` is resolved
 * locally (no fetch, no timeout) and cached as always-valid for the job.
 *
 * ## Read-only posture
 *
 * Every returned value is cloned via `structuredClone` and **deep-frozen**
 * before it lands in `globals`, mirroring the W3 template-context convention.
 * An uncloneable value is isolated to its own spec (`invalid` warning); it
 * never rejects the job.
 *
 * ## Extract grammar (non-Turing)
 *
 * `GlobalSpec.extract` is a **string**, never executed. The grammar is a
 * dotted path over the parsed JSON body, optionally followed by a literal
 * fallback:
 *
 *     path                  → required; segments split on `.`
 *     path '|' fallback     → value, or `fallback` when the path is absent
 *
 * The path is trimmed, then a leading `$.`, `$`, or single `.` is stripped
 * (so `.rate`, `$.rate`, `$rate`, and `rate` are equivalent).
 *
 * - A segment is a property key, or a non-negative integer index for arrays
 *   (`items.0.name`). Keys containing `.` or `|` cannot be addressed. Only
 *   **own data properties** are read: an accessor (getter/setter) is treated as
 *   path-absent, so no body-supplied code runs during extraction.
 * - `fallback` is literal text. It is parsed as JSON when it is valid JSON
 *   (`{...}`, `[1,2]`, `42`, `true`, `null`, `"x"`), otherwise it is the raw
 *   string. An empty fallback yields `undefined`.
 * - Missing path with no fallback is an `extract` warning and contributes no
 *   `globals.<name>`.
 * - The value must be structured-cloneable; anything else is an `extract`
 *   warning.
 *
 * The grammar is intentionally tiny. Richer selectors (JSONPath, templates)
 * plug in through the {@link Extract} seam without touching the fetch/cache
 * machinery.
 */

import type { GlobalSpec, RemoteGlobalSpec } from '../core/doc/types';

/** Default cap on concurrent fetches per prefetch call. */
export const DEFAULT_CONCURRENCY = 4;

/** Default per-spec timeout, in ms. A timeout fails only that spec. */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** Return type of an extractor: `undefined` means "absent". */
export type Extract = (body: unknown) => unknown;

/** Injection seam for treatable side effects. Both default to browser built-ins. */
export interface GlobalFetchDeps {
    /** Fetch and parse a JSON body. Defaults to `fetch` + `response.json()`. */
    fetchJson?: (url: string, signal?: AbortSignal) => Promise<unknown>;
    /** Clock in the same units as the cache key. Defaults to `Date.now` (ms). */
    now?: () => number;
}

/** Why a spec contributed no value. `kind` is what the UI badges on. */
export interface GlobalWarning {
    name: string;
    kind: 'timeout' | 'fetch' | 'extract' | 'invalid';
    message: string;
    url: string;
}

/** Resolved globals for one job, ready to spread into `TemplateContext.globals`. */
export interface GlobalsResult {
    values: Record<string, unknown>;
    warnings: GlobalWarning[];
}

/** A job-scoped cache: share within a job, dropped when the job ends. */
export interface GlobalsCache {
    /** {@link prefetchGlobals}, reusing this cache's valid entries. */
    prefetch(specs: readonly GlobalSpec[], deps?: GlobalFetchDeps): Promise<GlobalsResult>;
    /** Drop all cached entries (call at job end / on document change). */
    clear(): void;
}

/**
 * Parse the optional `|` fallback half of an `extract` string. The fallback is
 * literal, not a path: JSON when parseable, otherwise the raw string.
 */
const parseFallback = (raw: string): unknown => {
    if (raw.length === 0) return undefined;
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return raw;
    }
};

/**
 * Normalize the path half of an `extract` string. After trimming, a leading
 * `$.`, `$`, or a single leading `.` is stripped (JSONPath-flavoured sugar), so
 * `.rate`, `$.rate`, `$rate`, and `rate` all address the same key. Only one
 * leading `.` is stripped, so a dotted path is otherwise unchanged.
 */
const normalizePath = (path: string): string => {
    if (path.startsWith('$.')) return path.slice(2);
    if (path.startsWith('$')) return path.slice(1);
    if (path.startsWith('.')) return path.slice(1);
    return path;
};

/**
 * Build an {@link Extract} from a spec's `extract` grammar. The returned
 * function only walks/probes — it never evaluates the string, and it reads
 * only **own data properties**, never accessors. A getter/setter is treated as
 * path-absent (a data selector must not run body-supplied code), so a hostile
 * or merely surprising `get` on the parsed body can never execute here.
 */
export const createExtract = (expr: string): Extract => {
    const pipeIndex = expr.indexOf('|');
    const path = normalizePath((pipeIndex === -1 ? expr : expr.slice(0, pipeIndex)).trim());
    const hasFallback = pipeIndex !== -1;
    const fallback = hasFallback ? parseFallback(expr.slice(pipeIndex + 1).trim()) : undefined;
    const segments = path.length === 0 ? [] : path.split('.');

    return (body: unknown): unknown => {
        let current: unknown = body;
        for (const segment of segments) {
            if (typeof current !== 'object' || current === null) {
                return hasFallback ? fallback : undefined;
            }
            // Own property only; read the descriptor so an accessor is never
            // invoked. Arrays expose indices as own data properties.
            const descriptor = Object.getOwnPropertyDescriptor(current, segment);
            if (descriptor === undefined || !('value' in descriptor)) {
                return hasFallback ? fallback : undefined;
            }
            current = descriptor.value;
        }
        return current;
    };
};

/**
 * Is `value` safe to `postMessage`? Rejects callables, symbols, and objects
 * that `structuredClone` cannot handle (`WeakMap`, `WeakSet`, `Promise`,
 * `Error`, class instances with unknown shape). Allows the W3 set: JSON-like
 * plain objects/arrays plus `Date`, `Map`, `Set`, and typed arrays.
 */
const isStructuredCloneable = (value: unknown, seen: Set<object> = new Set()): boolean => {
    if (value === null) return true;
    switch (typeof value) {
        case 'string':
        case 'number':
        case 'boolean':
        case 'undefined':
        case 'bigint':
            return true;
        case 'function':
        case 'symbol':
            return false;
        default:
            break;
    }
    const object = value as object;
    if (seen.has(object)) return true; // cycles: let structuredClone decide
    seen.add(object);
    if (Array.isArray(object)) {
        return object.every((entry) => isStructuredCloneable(entry, seen));
    }
    if (object instanceof Date) return true;
    if (object instanceof Map) {
        return [...object.entries()].every(
            ([key, entry]) => isStructuredCloneable(key, seen) && isStructuredCloneable(entry, seen),
        );
    }
    if (object instanceof Set) {
        return [...object.values()].every((entry) => isStructuredCloneable(entry, seen));
    }
    if (ArrayBuffer.isView(object)) return true;
    // Anything with a non-plain prototype is not a shape the worker expects
    // (WeakMap/WeakSet/Promise/Error/class instances). Reject rather than risk
    // a `structuredClone` throw.
    const prototype = Object.getPrototypeOf(object) as object | null;
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Object.keys(object)) {
        if (!isStructuredCloneable((object as Record<string, unknown>)[key], seen)) return false;
    }
    return true;
};

/** True for plain objects/arrays, which we deep-freeze; other object-likes are best-effort. */
const isPlainObjectLike = (value: object): boolean => {
    if (Array.isArray(value)) return true;
    const prototype = Object.getPrototypeOf(value) as object | null;
    return prototype === Object.prototype || prototype === null;
};

/**
 * Deep-freeze a cloned value. Plain objects/arrays are frozen recursively so a
 * template's `globals.<name>` view is read-only per the W3 posture. Non-plain
 * object-likes (`Date`, `Map`, `Set`, typed arrays) are best-effort frozen at
 * the top level only — their internal contents cannot be frozen (W3 convention).
 */
const deepFreeze = (value: unknown, seen: Set<object> = new Set()): void => {
    if (typeof value !== 'object' || value === null) return;
    const object = value as object;
    if (seen.has(object)) return;
    seen.add(object);
    if (!isPlainObjectLike(object)) {
        try {
            Object.freeze(object);
        } catch {
            // e.g. a typed array with elements cannot be frozen.
        }
        return;
    }
    for (const key of Object.keys(object)) {
        const descriptor = Object.getOwnPropertyDescriptor(object, key);
        if (descriptor !== undefined && 'value' in descriptor) {
            deepFreeze(descriptor.value, seen);
        }
    }
    try {
        Object.freeze(object);
    } catch {
        // best-effort
    }
};

/**
 * Clone a value for isolation, then deep-freeze it. Returns `undefined` when
 * the value cannot be cloned (an uncloneable value must not reject the job).
 * `structuredClone` is preferred; JSON is the fallback for older runtimes.
 */
const cloneAndFreeze = (value: unknown): { ok: true; value: unknown } | { ok: false } => {
    let cloned: unknown;
    try {
        cloned = typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as unknown);
    } catch {
        return { ok: false };
    }
    deepFreeze(cloned);
    return { ok: true, value: cloned };
};

/**
 * Dedupe specs by `name`, keeping the **first** occurrence (first-wins). A
 * later spec with the same name is dropped: one `globals.<name>` per job. The
 * dropped duplicate is reported as an `{ kind: 'invalid' }` warning naming the
 * spec, so a silent discard cannot happen. When `warnings` is omitted the
 * caller only wants the unique list.
 */
const dedupeByName = (specs: readonly GlobalSpec[], warnings?: GlobalWarning[]): GlobalSpec[] => {
    const byName = new Map<string, GlobalSpec>();
    for (const spec of specs) {
        const existing = byName.get(spec.name);
        if (existing === undefined) {
            byName.set(spec.name, spec);
        } else if (warnings !== undefined) {
            warnings.push(warn(spec, 'invalid', `duplicate global name "${spec.name}" ignored (first spec kept)`));
        }
    }
    return [...byName.values()];
};

/**
 * Cache identity for a spec. Keyed on the full union identity — `name`, `kind`,
 * and the kind-specific fields (`value`, or `url`/`extract`/`expiresAt`) — so
 * two specs that share a name or an expiry can never serve each other's value,
 * and a static spec can never collide with a remote one. The fields are
 * JSON-encoded as a tuple, so distinct field lists always produce distinct keys:
 * a delimiter character cannot make two different specs collide, because any
 * character in a field is quoted/escaped by `JSON.stringify`.
 */
const cacheKey = (spec: GlobalSpec): string =>
    spec.kind === 'static'
        ? JSON.stringify([spec.name, 'static', spec.value])
        : JSON.stringify([spec.name, 'remote', spec.url, spec.extract, spec.expiresAt]);

/** A cache entry: a resolved frozen value, or an in-flight fetch to await. */
interface CacheEntry {
    value?: unknown;
    pending?: Promise<{ name: string; value: unknown } | GlobalWarning>;
}

/**
 * Is a cached **remote** entry reusable? `expiresAt` is epoch seconds, so
 * multiply by 1000 and require it to be strictly in the future. **Boundary
 * decision:** `expiresAt * 1000 === now` is treated as **expired** (`>` is
 * strict), so a second granularity expiry is never used for the exact second it
 * lapses. Static entries carry no expiry and are always valid.
 */
const isEntryValid = (spec: RemoteGlobalSpec, nowMs: number): boolean =>
    Number.isFinite(spec.expiresAt) && spec.expiresAt * 1000 > nowMs;

const warn = (spec: GlobalSpec, kind: GlobalWarning['kind'], message: string): GlobalWarning => ({
    name: spec.name,
    kind,
    message,
    // A static spec has no URL; the warning carries an empty source.
    url: spec.kind === 'static' ? '' : spec.url,
});

/** Default fetch: `fetch` the URL and parse JSON, aborted by `signal`. */
const defaultFetchJson = async (url: string, signal?: AbortSignal): Promise<unknown> => {
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as unknown;
};

/**
 * Fetch one **remote** spec once, extract, validate, clone, and freeze. Never
 * throws: every failure becomes a {@link GlobalWarning} plus an absent value, so
 * one bad spec can never reject the job.
 */
const fetchSpec = async (
    spec: RemoteGlobalSpec,
    fetchJson: NonNullable<GlobalFetchDeps['fetchJson']>,
    timeoutMs: number,
): Promise<{ name: string; value: unknown } | GlobalWarning> => {
    if (spec.extract.trim().length === 0) {
        return warn(spec, 'invalid', 'extract is empty');
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new Error(`timed out after ${timeoutMs} ms`));
        }, timeoutMs);
    });

    let body: unknown;
    let timedOut = false;
    const fetchPromise = fetchJson(spec.url, controller.signal);
    try {
        body = await Promise.race([fetchPromise, timeout]);
    } catch (error) {
        // The timeout may reject first; observe the same fetch promise so its
        // later abort does not surface as an unhandled rejection.
        void fetchPromise.catch(() => undefined);
        timedOut = controller.signal.aborted;
        return warn(spec, timedOut ? 'timeout' : 'fetch', error instanceof Error ? error.message : String(error));
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }

    let raw: unknown;
    try {
        raw = createExtract(spec.extract)(body);
    } catch (error) {
        return warn(spec, 'extract', error instanceof Error ? error.message : String(error));
    }
    if (raw === undefined) {
        return warn(spec, 'extract', `path "${spec.extract}" is absent`);
    }
    if (!isStructuredCloneable(raw)) {
        return warn(spec, 'invalid', 'extracted value is not structured-cloneable');
    }

    const cloned = cloneAndFreeze(raw);
    if (!cloned.ok) {
        return warn(spec, 'invalid', 'extracted value could not be cloned');
    }
    return { name: spec.name, value: cloned.value };
};

const isGlobalWarning = (result: { name: string; value: unknown } | GlobalWarning): result is GlobalWarning =>
    (result as GlobalWarning).kind !== undefined;

/** Run tasks with at most `limit` in flight; results keep task order. */
const mapWithConcurrency = async <T, R>(
    items: readonly T[],
    limit: number,
    task: (item: T) => Promise<R>,
): Promise<R[]> => {
    const results = new Array<R>(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await task(items[index] as T);
        }
    });
    await Promise.all(workers);
    return results;
};

/**
 * Resolve specs against a shared cache map. A valid entry is served without
 * fetching; otherwise the in-flight fetch is stored in the same entry so
 * concurrent callers for the same spec await one fetch, and the resolved
 * (frozen) value replaces it.
 */
const prefetchInto = async (
    specs: readonly GlobalSpec[],
    cache: Map<string, CacheEntry>,
    deps: GlobalFetchDeps,
): Promise<GlobalsResult> => {
    const now = deps.now ?? Date.now;
    const fetchJson = deps.fetchJson ?? defaultFetchJson;
    const nowMs = now();

    const warnings: GlobalWarning[] = [];
    const unique = dedupeByName(specs, warnings);

    const results = await mapWithConcurrency(unique, DEFAULT_CONCURRENCY, async (spec) => {
        const key = cacheKey(spec);
        const entry = cache.get(key);

        // Static specs never fetch and never expire: resolve their literal value
        // once and cache it as always-valid for the job.
        if (spec.kind === 'static') {
            if (entry?.value !== undefined) {
                return { name: spec.name, value: entry.value } as { name: string; value: unknown };
            }
            const cloned = cloneAndFreeze(spec.value);
            if (!cloned.ok) {
                return warn(spec, 'invalid', 'static value could not be cloned');
            }
            cache.set(key, { value: cloned.value });
            return { name: spec.name, value: cloned.value } as { name: string; value: unknown };
        }

        if (entry !== undefined && isEntryValid(spec, nowMs) && entry.value !== undefined) {
            return { name: spec.name, value: entry.value } as { name: string; value: unknown };
        }
        if (entry?.pending !== undefined) {
            return entry.pending;
        }

        const pending = fetchSpec(spec, fetchJson, DEFAULT_TIMEOUT_MS).then((result) => {
            // Replace the in-flight promise with the resolved value when valid;
            // a failed spec is left without a reusable value.
            if (!isGlobalWarning(result) && isEntryValid(spec, nowMs)) {
                cache.set(key, { value: result.value });
            } else {
                cache.delete(key);
            }
            return result;
        });
        // Store the pending promise under the same entry; a concurrent caller
        // for the identical spec awaits it instead of fetching again.
        cache.set(key, { pending });
        return pending;
    });

    const values: Record<string, unknown> = {};
    for (const result of results) {
        if (isGlobalWarning(result)) warnings.push(result);
        else values[result.name] = result.value;
    }
    return { values, warnings };
};

/**
 * One-shot prefetch with a private cache. Use {@link createGlobalsCache} when
 * several calls must share cache state within one job; never share a cache
 * across jobs (values carry another job's network snapshot).
 */
export const prefetchGlobals = async (
    specs: readonly GlobalSpec[],
    deps: GlobalFetchDeps = {},
): Promise<GlobalsResult> => prefetchInto(specs, new Map<string, CacheEntry>(), deps);

/**
 * Create a cache scoped to one job. Valid entries (`expiresAt * 1000 > now`)
 * are reused across calls; expired entries are refetched and replaced.
 * Concurrent prefetches of the same spec share one in-flight fetch. `clear()`
 * at job end prevents the snapshot from leaking into the next job.
 */
export const createGlobalsCache = (): GlobalsCache => {
    const cache = new Map<string, CacheEntry>();
    return {
        prefetch(specs, deps = {}) {
            return prefetchInto(specs, cache, deps);
        },
        clear() {
            cache.clear();
        },
    };
};

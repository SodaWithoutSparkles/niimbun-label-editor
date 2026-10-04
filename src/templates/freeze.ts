/**
 * Throwing-Proxy freeze for template **data** contexts.
 *
 * The worker hands user code a Proxy instead of the plain context object, so
 * writes, deletes, `defineProperty`, and `setPrototypeOf` on wrapped objects and
 * arrays throw a `TypeError`. Reads pass through unchanged, including identity
 * of the prototype: `getPrototypeOf` returns the real prototype, so
 * `x instanceof Object` and `Object.prototype.isPrototypeOf(x)` keep working.
 * An own `constructor` key (a legitimate CSV column) reads its value normally.
 *
 * This is a mutation guard, NOT a sandbox. It does **not** block realm-prototype
 * pollution: `Object.getPrototypeOf(ctx.row).x = 1` and
 * `ctx.row.constructor.prototype.x = 1` still reach the real `Object.prototype`.
 * That is accepted under the trusted-user-code threat model (owner decision 3);
 * the real egress control is CSP (`worker-src` / `connect-src`), not this Proxy.
 *
 * Depth notes:
 * - Structured clone does not only produce plain objects: `Date`, `Map`, `Set`,
 *   `RegExp`, and typed arrays survive it. Those are returned raw (a Proxy over
 *   them would break their internal slots), so we best-effort `Object.freeze`
 *   them. Freezing does not stop `Map`/`Set`/typed-array *contents* from
 *   changing — that cannot be deep-frozen — so treat them as read-only by
 *   convention.
 * - `getOwnPropertyDescriptor` hands back wrapped values, so the descriptor is
 *   not a back door to the raw target.
 */

const isWrappable = (value: unknown): value is object => typeof value === 'object' && value !== null;

const isPlainObject = (value: object): boolean => {
    const prototype = Object.getPrototypeOf(value) as object | null;
    return prototype === Object.prototype || prototype === null;
};

const readonlyError = (action: string): TypeError => new TypeError(`Template context is read-only (cannot ${action}).`);

const freezeObjectLike = (value: object): void => {
    try {
        Object.freeze(value);
    } catch {
        // e.g. a typed array with elements cannot be frozen; nothing else to do.
    }
};

/**
 * Returns a view of `value` that throws `TypeError` on mutation, recursively for
 * nested arrays/objects. Primitives are returned as-is (they cannot mutate).
 * Cyclic structures are supported via the per-call identity cache.
 */
export const createFrozenContext = <T>(value: T): T => {
    const cache = new WeakMap<object, object>();

    const wrap = (target: object): object => {
        const cached = cache.get(target);
        if (cached !== undefined) return cached;
        const proxy = new Proxy(target, {
            get(object, key, receiver) {
                const result = Reflect.get(object, key, receiver) as unknown;
                if (isWrappable(result)) {
                    if (Array.isArray(result) || isPlainObject(result)) {
                        return wrap(result);
                    }
                    freezeObjectLike(result);
                }
                return result;
            },
            getOwnPropertyDescriptor(object, key) {
                const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
                if (descriptor !== undefined && descriptor.configurable && 'value' in descriptor) {
                    const entry = descriptor.value as unknown;
                    if (isWrappable(entry) && (Array.isArray(entry) || isPlainObject(entry))) {
                        return { ...descriptor, value: wrap(entry) };
                    }
                }
                return descriptor;
            },
            set: () => {
                throw readonlyError('set');
            },
            deleteProperty: () => {
                throw readonlyError('delete');
            },
            defineProperty: () => {
                throw readonlyError('defineProperty');
            },
            setPrototypeOf: () => {
                throw readonlyError('setPrototypeOf');
            },
        });
        cache.set(target, proxy);
        return proxy;
    };

    return isWrappable(value) ? (wrap(value) as T) : value;
};

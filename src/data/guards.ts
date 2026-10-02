/**
 * Shared, dependency-free guards for the storage layer. Kept out of the public
 * repo interfaces on purpose: these are internal value checks used by every
 * `src/data` module.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

export const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

/** `instanceof Blob` guarded so a runtime without `Blob` does not throw. */
export const isBlob = (value: unknown): value is Blob =>
    typeof Blob !== 'undefined' && value instanceof Blob;

export const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string');

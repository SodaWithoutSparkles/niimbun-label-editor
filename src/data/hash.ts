/**
 * SHA-256 helpers for the `src/data` layer (P5 decision 6).
 *
 * A resource fingerprint is computed **once at import** and stored on the
 * `AssetRef.local`; it is never re-hashed on load. Hashing stays in the data
 * layer so `src/core/` remains DOM/crypto-free and `src/editor/` never grows a
 * second hashing path.
 *
 * Web Crypto is the only implementation. Runtimes without it (older workers,
 * insecure contexts) get a clear, catchable error rather than a silent wrong
 * value; callers decide whether import can proceed without a fingerprint.
 */

const HEX_DIGITS = '0123456789abcdef';

/** Lowercase hex encoding of arbitrary bytes. */
const toHex = (bytes: Uint8Array): string => {
    let out = '';
    for (const byte of bytes) {
        out += HEX_DIGITS[byte >> 4]! + HEX_DIGITS[byte & 0x0f]!;
    }
    return out;
};

/**
 * SHA-256 of `bytes` as a lowercase hex string.
 *
 * @throws {Error} when `crypto.subtle.digest` is unavailable (e.g. an insecure
 *   context or a runtime without Web Crypto). The message names the missing
 *   capability so callers can surface it or fall back to a fingerprintless
 *   import.
 */
export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== 'function') {
        throw new Error('sha256Hex: crypto.subtle.digest is unavailable in this runtime');
    }
    // `digest` hashes exactly the view's bytes (offset/length respected).
    const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return toHex(new Uint8Array(digest));
};

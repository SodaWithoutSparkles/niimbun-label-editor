import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from './hash';

/** UTF-8 bytes of an ASCII string. */
const ascii = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('sha256Hex', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('matches the empty-input vector', async () => {
        await expect(sha256Hex(new Uint8Array())).resolves.toBe(
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        );
    });

    it('matches the "abc" vector', async () => {
        await expect(sha256Hex(ascii('abc'))).resolves.toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });

    it('hashes only the view, not the whole backing buffer', async () => {
        // A subarray must hash its own bytes, not the surrounding buffer.
        const backing = ascii('XXabcXX');
        const view = backing.subarray(2, 5); // "abc"
        await expect(sha256Hex(view)).resolves.toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });

    it('throws a clear error when crypto.subtle is unavailable', async () => {
        vi.stubGlobal('crypto', {});
        await expect(sha256Hex(new Uint8Array())).rejects.toThrow(/crypto\.subtle/);
    });
});

import { describe, expect, it } from 'vitest';
import { compress, compressToBase64, decompress } from './compress';

/**
 * Vitest's stream adapter (both happy-dom and its "node" environment) rejects a
 * raw `ArrayBuffer` chunk and requires a `Uint8Array` view. Real browsers and
 * plain Node accept an ArrayBuffer, so `decompress` is correct as written; this
 * helper only normalises the argument for the test runner and is applied to the
 * *input* of the real `decompress`, which still performs the stream read and
 * decode under test.
 */
const asRunnerChunk = (buffer: ArrayBuffer): ArrayBuffer =>
    new Uint8Array(buffer) as unknown as ArrayBuffer;

describe('compress / decompress round-trip', () => {
    it('round-trips a plain string through gzip', async () => {
        const original = 'hello world — unicode ✓ and "quotes"';
        const compressed = await compress(original);
        await expect(decompress(asRunnerChunk(compressed))).resolves.toBe(original);
    });

    it('round-trips through the base64 helpers', async () => {
        const original = JSON.stringify({ version: '1.0.0', items: [1, 2, 3] });
        const base64 = await compressToBase64(original);
        // decompressFromBase64 rebuilds an ArrayBuffer internally; normalise it
        // the same way for the runner.
        const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        await expect(decompress(asRunnerChunk(raw.buffer))).resolves.toBe(original);
    });

    it('actually shrinks repetitive payloads', async () => {
        const original = 'abc'.repeat(5000);
        const compressed = await compress(original);
        expect(compressed.byteLength).toBeLessThan(original.length);
    });
});

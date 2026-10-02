import { afterEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Regression: `compress` deadlocked in a real (headed) browser. It wrote to a
 * `CompressionStream` and only attached a consumer afterwards, so the write
 * promise never settled (backpressure with no reader) — `repo.save` hung and the
 * create dialog's `saving` flag stayed `true` forever. headless tests missed it
 * because happy-dom's stream never applies that backpressure.
 *
 * The fake below reproduces the browser's backpressure deterministically: its
 * writable side only drains once the readable side is actually being consumed.
 * The old (write-then-read) order never drains → the write times out; the fixed
 * order attaches the consumer first → it drains.
 */
const makeBackpressureCompressionStream = (): typeof CompressionStream => {
    let signalRead: () => void = () => {};
    const readStarted = new Promise<void>((resolve) => {
        signalRead = resolve;
    });
    class BackpressureCompressionStream {
        readonly writable = {
            getWriter() {
                return {
                    async write() {
                        // Only completes once the readable side has a consumer.
                        await Promise.race([
                            readStarted,
                            new Promise<never>((_, reject) =>
                                setTimeout(
                                    () => reject(new Error('deadlock: writable side never drained')),
                                    1000,
                                ),
                            ),
                        ]);
                    },
                    async close() {},
                };
            },
        };
        readonly readable = (() => {
            const stream = new ReadableStream<Uint8Array>({
                pull(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3]));
                    controller.close();
                },
            });
            // Signal only when a consumer actually attaches — exactly when a
            // real `CompressionStream`'s readable side begins to drain. `pull`
            // can fire eagerly at construction, so patching `getReader` is the
            // faithful trigger for the browser's backpressure: with the old
            // write-then-read order, `write` is called before any reader exists
            // and so times out.
            const origGetReader = stream.getReader.bind(stream);
            Object.defineProperty(stream, 'getReader', {
                configurable: true,
                value: () => {
                    signalRead();
                    return origGetReader();
                },
            });
            return stream;
        })();
    }
    return BackpressureCompressionStream as unknown as typeof CompressionStream;
};

describe('compress — browser backpressure regression', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('drains the readable side while writing (never deadlocks)', async () => {
        vi.stubGlobal('CompressionStream', makeBackpressureCompressionStream());
        await expect(compress('payload')).resolves.toBeInstanceOf(ArrayBuffer);
    });
});

/**
 * happy-dom's `Response` cannot consume a `CompressionStream` /
 * `DecompressionStream` readable — its `consumeBodyStream` rejects with an
 * `EncodingError` once the stream settles. So in the happy-dom test files
 * (`serialize.test.ts`, `labelRepo.test.ts`) the tests adapt the primitive
 * instead of the app: this response reads the supplied stream directly.
 *
 * Two properties matter, and both still hold *even though `compress.ts` now
 * attaches its own no-op `.catch` at creation*:
 *   1. it makes the happy-dom round-trip work at all (the stub's load-bearing
 *      reason — do NOT delete it while those files run under happy-dom); and
 *   2. it keeps the read promise internally handled, so a stream rejection can
 *      never surface as an unhandled rejection even if a caller abandons it.
 * `arrayBuffer()` / `text()` still return the genuine streamed bytes and still
 * reject on failure, so the round-trip under test is unchanged.
 *
 * `src/utils/saveFileRoundTrip.test.ts` runs `@vitest-environment node` (undici
 * `Response`, which reads a stream body fine) and deliberately does NOT stub.
 */
export class StreamReadingResponse {
    private readonly read: Promise<ArrayBuffer>;

    constructor(body: ReadableStream<Uint8Array>) {
        this.read = StreamReadingResponse.consume(body);
        // Attach a handler now so the stream's own rejection is never unhandled,
        // regardless of whether the app awaits `arrayBuffer()`/`text()`.
        void this.read.catch(() => {});
    }

    arrayBuffer(): Promise<ArrayBuffer> {
        return this.read;
    }

    text(): Promise<string> {
        // Must not be an `async` method: an async wrapper creates a *fresh*
        // promise whose rejection is not covered by the constructor's handler,
        // which is exactly how the app's un-awaited `decompress` failure leaked
        // an unhandled rejection. Chain off the pre-handled read instead and
        // attach a handler to this derived promise too.
        const text = this.read.then((buffer) => new TextDecoder().decode(buffer));
        void text.catch(() => {});
        return text;
    }

    private static async consume(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const total = chunks.reduce((n, chunk) => n + chunk.length, 0);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out.buffer;
    }
}

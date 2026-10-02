export const compress = async (
    str: string,
    encoding: CompressionFormat = 'gzip'
): Promise<ArrayBuffer> => {
    // Convert the string into a Uint8Array
    const byteArray = new TextEncoder().encode(str);

    // Create a new CompressionStream instance
    const cs = new CompressionStream(encoding);

    // Start draining the readable side BEFORE writing. `CompressionStream`
    // applies backpressure to `writer.write` while its readable side has no
    // consumer, so awaiting `write`/`close` first and reading afterwards
    // deadlocks in a real browser (the write promise never settles). Attaching
    // the consumer first keeps the pipe flowing. The read is awaited at the end.
    const compressed = new Response(cs.readable).arrayBuffer();
    // A corrupt/abandoned read (e.g. `parseDoc` bailing on a bad gzip body)
    // would otherwise surface as an unhandled rejection. This does not change
    // behaviour: the promise still rejects where it is awaited below.
    void compressed.catch(() => {});

    // Use a writer to write the data to the stream's writable side
    const writer = cs.writable.getWriter();
    await writer.write(byteArray);
    await writer.close();

    // Read the compressed data from the readable side into an ArrayBuffer
    return compressed;
};

export const decompress = async (
    byteArray: ArrayBuffer,
    encoding: CompressionFormat = 'gzip'
): Promise<string> => {
    // Create a new DecompressionStream instance
    const ds = new DecompressionStream(encoding);

    // Start reading BEFORE writing, for the same backpressure/deadlock reason as
    // `compress` above. Decode the streamed bytes back into a string.
    const decompressed = new Response(ds.readable).text();
    // Same no-op catch as `compress`: never let an abandoned read become an
    // unhandled rejection; the awaited promise below still rejects normally.
    void decompressed.catch(() => {});

    // Use a writer to write the compressed data
    const writer = ds.writable.getWriter();
    await writer.write(byteArray);
    await writer.close();

    // Read the decompressed data and decode it back to a string
    return decompressed;
};

// Helpers for storing compressed data as base64 strings (useful for localStorage)
const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
};

const base64ToArrayBuffer = (base64: string) => {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
};

export const compressToBase64 = async (
    str: string,
    encoding: CompressionFormat = 'gzip'
): Promise<string> => {
    const compressed = await compress(str, encoding);
    return arrayBufferToBase64(compressed);
};

export const decompressFromBase64 = async (
    base64: string,
    encoding: CompressionFormat = 'gzip'
): Promise<string> => {
    const buffer = base64ToArrayBuffer(base64);
    return decompress(buffer, encoding);
};


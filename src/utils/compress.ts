export const compress = async (
    str: string,
    encoding: CompressionFormat = 'gzip'
): Promise<ArrayBuffer> => {
    // Convert the string into a Uint8Array
    const byteArray = new TextEncoder().encode(str);

    // Create a new CompressionStream instance
    const cs = new CompressionStream(encoding);

    // Use a writer to write the data to the stream's writable side
    const writer = cs.writable.getWriter();
    writer.write(byteArray);
    writer.close();

    // Read the compressed data from the readable side into an ArrayBuffer
    return new Response(cs.readable).arrayBuffer();
};

export const decompress = async (
    byteArray: ArrayBuffer,
    encoding: CompressionFormat = 'gzip'
): Promise<string> => {
    // Create a new DecompressionStream instance
    const ds = new DecompressionStream(encoding);

    // Use a writer to write the compressed data
    const writer = ds.writable.getWriter();
    writer.write(byteArray);
    writer.close();

    // Read the decompressed data and decode it back to a string
    const decompressedResponse = new Response(ds.readable);
    const decompressedBlob = await decompressedResponse.blob();
    return decompressedBlob.text();
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


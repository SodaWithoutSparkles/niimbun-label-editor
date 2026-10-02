import { compress, decompress } from '../../utils/compress';
import type { LabelDoc } from './types';
import { isLabelDoc, migrate, type ValidationResult } from './validate';

/**
 * `.lbl.json.gz` = gzip'd JSON of a `LabelDoc`. Plain JSON integers — no typed
 * arrays. Reuses `src/utils/compress.ts` (CompressionStream gzip). Both paths
 * are pure and never throw; a bad parse surfaces as `{ ok: false, errors }`.
 */

export const serializeDoc = async (doc: LabelDoc): Promise<ArrayBuffer> => {
    return compress(JSON.stringify(doc), 'gzip');
};

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const gzipPayload = (bytes: Uint8Array): ArrayBuffer =>
    // `.slice()` copies, so a view with a byte offset gets an exact-size buffer.
    bytes.slice().buffer;

export type ParseInput = ArrayBuffer | Uint8Array | string;

export const parseDoc = async (input: ParseInput): Promise<ValidationResult> => {
    let json: string;

    if (typeof input === 'string') {
        json = input;
    } else {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        if (bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1) {
            try {
                json = await decompress(gzipPayload(bytes), 'gzip');
            } catch (error) {
                return {
                    ok: false,
                    errors: [`parse: could not decompress document (${errorMessage(error)})`],
                };
            }
        } else {
            // Tolerate a plain (uncompressed) JSON body — useful for import.
            json = new TextDecoder().decode(bytes);
        }
    }

    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch (error) {
        return { ok: false, errors: [`parse: invalid JSON (${errorMessage(error)})`] };
    }

    return isLabelDoc(migrate(raw));
};

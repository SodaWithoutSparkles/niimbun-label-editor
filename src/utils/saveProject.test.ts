import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildDefaultSaveName,
    ensureSaveExtension,
    parseSaveFile,
    parseTimestamp,
    sanitizeFilename,
    shouldSaveAsJson,
} from './saveProject';

// `parseSaveFile`'s gzip fallback calls `decompress`. Mock it so the branch is
// exercised with real routing (raw ArrayBuffer in, JSON string out) without the
// Vitest stream adapter, which rejects raw ArrayBuffer chunks in both the
// happy-dom and node environments. The real gzip codec is covered end-to-end in
// `compress.test.ts` with that adapter normalised at the boundary.
const decompressMock = vi.hoisted(() => vi.fn());
vi.mock('./compress', () => ({
    compress: vi.fn(),
    decompress: decompressMock,
}));

describe('sanitizeFilename', () => {
    it('strips every forbidden character', () => {
        expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    });

    it('trims surrounding whitespace', () => {
        expect(sanitizeFilename('  my project  ')).toBe('my project');
    });

    it('falls back when the cleaned name is empty', () => {
        expect(sanitizeFilename('')).toBe('project');
        expect(sanitizeFilename('///')).toBe('project');
        expect(sanitizeFilename('   ')).toBe('project');
    });

    it('preserves normal names with dots, dashes and unicode', () => {
        expect(sanitizeFilename('my-diagram.v2')).toBe('my-diagram.v2');
        expect(sanitizeFilename('café_naïve')).toBe('café_naïve');
    });
});

describe('ensureSaveExtension', () => {
    it('keeps .fsp and .json (case-insensitive)', () => {
        expect(ensureSaveExtension('file.fsp')).toBe('file.fsp');
        expect(ensureSaveExtension('file.JSON')).toBe('file.JSON');
    });

    it('appends .fsp to anything else (including other extensions)', () => {
        expect(ensureSaveExtension('file')).toBe('file.fsp');
        expect(ensureSaveExtension('file.txt')).toBe('file.txt.fsp');
    });
});

describe('shouldSaveAsJson', () => {
    it('is true only for a .json name', () => {
        expect(shouldSaveAsJson('a.json')).toBe(true);
        expect(shouldSaveAsJson('A.JSON')).toBe(true);
        expect(shouldSaveAsJson('a.fsp')).toBe(false);
        expect(shouldSaveAsJson(null)).toBe(false);
        expect(shouldSaveAsJson(undefined)).toBe(false);
    });
});

describe('buildDefaultSaveName', () => {
    it('sanitizes the project name and adds the extension', () => {
        expect(buildDefaultSaveName('my/project')).toBe('myproject.fsp');
    });

    it('falls back to a generated name when empty', () => {
        const name = buildDefaultSaveName('');
        expect(name.endsWith('.fsp')).toBe(true);
        expect(name.length).toBeGreaterThan('.fsp'.length);
    });
});

describe('parseTimestamp', () => {
    it('returns null for missing/invalid input', () => {
        expect(parseTimestamp(undefined)).toBeNull();
        expect(parseTimestamp('not a date')).toBeNull();
    });

    it('parses a Date and a string', () => {
        const date = new Date('2020-01-02T03:04:05.000Z');
        expect(parseTimestamp(date)).toBe(date.getTime());
        expect(parseTimestamp(date.toISOString())).toBe(date.getTime());
    });
});

describe('parseSaveFile', () => {
    beforeEach(() => {
        decompressMock.mockReset();
    });

    it('reads a plain JSON save file', async () => {
        const json = JSON.stringify({ version: '1.0.0', projectName: 'plain' });
        const file = new File([json], 'plain.fsp');
        await expect(parseSaveFile(file)).resolves.toEqual({ version: '1.0.0', projectName: 'plain' });
        expect(decompressMock).not.toHaveBeenCalled();
    });

    // The gzip fallback is reached when the raw bytes are not valid JSON: the
    // binary ArrayBuffer must be handed to `decompress`, and its decoded JSON
    // returned. (Real gzip codec output is covered in `compress.test.ts`.)
    it('routes non-JSON bytes to decompress and parses the result', async () => {
        decompressMock.mockResolvedValueOnce(
            JSON.stringify({ version: '1.0.0', projectName: 'gzipped' }),
        );
        const gzipBytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
        const file = new File([gzipBytes], 'gzipped.fsp');

        await expect(parseSaveFile(file)).resolves.toEqual({
            version: '1.0.0',
            projectName: 'gzipped',
        });
        expect(decompressMock).toHaveBeenCalledTimes(1);
        const passed = decompressMock.mock.calls[0][0];
        expect(passed).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(passed)).toEqual(gzipBytes);
    });
});

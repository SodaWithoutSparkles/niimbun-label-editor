// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSaveBlob, parseSaveFile } from './saveProject';
import { createAppStore } from '../store/useStore';
import { defaultKeyboardShortcuts, defaultToolSettings } from '../store/storeDefaults';
import type { SaveFile } from '../types';

/**
 * The test runtime's `DecompressionStream` writes straight into Node's `zlib`,
 * which (unlike browsers, per the Web Streams `BufferSource` chunk contract)
 * rejects a raw `ArrayBuffer` and only accepts a view. `decompress` passes the
 * `ArrayBuffer` from `File.arrayBuffer()` through unchanged, so the default
 * (gzip) `.fsp` save path cannot run here without normalising that platform
 * gap. This wrapper leaves the app's input a real `ArrayBuffer` and only adapts
 * the runtime primitive; production code is untouched.
 */
const NativeDecompressionStream = globalThis.DecompressionStream;
class ArrayBufferTolerantDecompressionStream extends NativeDecompressionStream {
    constructor(format: CompressionFormat = 'gzip') {
        super(format);
        const writable = this.writable;
        const getWriter = writable.getWriter.bind(writable);
        Object.defineProperty(writable, 'getWriter', {
            configurable: true,
            value: () => {
                const writer = getWriter();
                const write = writer.write.bind(writer);
                Object.defineProperty(writer, 'write', {
                    configurable: true,
                    value: (chunk: BufferSource) =>
                        write(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk),
                });
                return writer;
            },
        });
    }
}

/**
 * Minimal in-memory Storage so the store never touches the shared localStorage.
 */
const makeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
        get length() {
            return map.size;
        },
        clear: () => map.clear(),
        getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
        key: (index: number) => [...map.keys()][index] ?? null,
        removeItem: (key: string) => {
            map.delete(key);
        },
        setItem: (key: string, value: string) => {
            map.set(key, value);
        },
    };
};

/**
 * Mirror of `Header.buildSaveFile`'s writer contract. `buildSaveFile` is a
 * component-local closure, but this is the exact shape it produces; the test
 * locks the writer/reader whitelist contract between it and `loadProject`
 * without refactoring the component to export it.
 */
const writerSaveFile = (): SaveFile => ({
    version: '1.0.0',
    projectName: 'Round Trip',
    saveFileName: 'round-trip.fsp',
    createdAt: 1_700_000_000_000,
    timestamp: new Date('2024-01-02T03:04:05.000Z'),
    canvas: {
        objects: [{ id: 'shape-1', type: 'rectangle' }] as unknown as SaveFile['canvas']['objects'],
        past: [],
        future: [],
        selectedIds: [],
        hasPerformedClearAll: false,
    },
    colors: {
        colors: { stroke: '#123456', fill: '#abcdef', active: 'fill' },
        colorPresets: [{ stroke: '#123456', fill: '#abcdef' }],
        selectedPresetIndex: 2,
        isDropperActive: false,
        pickedColor: null,
    },
    tools: {
        activeTool: 'rectangle',
        toolSettings: defaultToolSettings,
        showToolSettings: true,
    },
    preferences: {
        history: [],
        historyUndoCount: 0,
        autoSave: true,
        keyboardShortcuts: defaultKeyboardShortcuts,
    },
    navigation: {
        canvasPosition: { x: 10, y: -5, scale: 1.5 },
    },
});

describe('buildSaveBlob <-> parseSaveFile <-> loadProject round-trip', () => {
    beforeEach(() => {
        vi.stubGlobal('DecompressionStream', ArrayBufferTolerantDecompressionStream);
    });

    it('round-trips the whitelisted project fields through a save blob', async () => {
        const saveFile = writerSaveFile();
        const blob = await buildSaveBlob(saveFile, true);
        const file = new File([blob], 'round-trip.json');
        const parsed = await parseSaveFile(file);

        const store = createAppStore(makeStorage());
        const before = store.getState();

        store.getState().loadProject(parsed);
        const after = store.getState();

        // Whitelisted project/canvas fields survive the writer -> reader -> load path.
        expect(after.projectName).toBe('Round Trip');
        expect(after.objects).toEqual(saveFile.canvas.objects);
        expect(after.activeTool).toBe('rectangle');
        expect(after.showToolSettings).toBe(true);
        expect(after.canvasPosition).toEqual({ x: 10, y: -5, scale: 1.5 });

        // Preference keys in the file never overwrite the user's own settings.
        expect(after.autoSave).toBe(before.autoSave);
        expect(after.keyboardShortcuts).toEqual(before.keyboardShortcuts);
        expect(after.colors).toEqual(before.colors);
        expect(after.colorPresets).toEqual(before.colorPresets);
    });

    it('round-trips the whitelisted project fields through the default gzip save blob', async () => {
        const saveFile = writerSaveFile();
        // `asJson: false` is the DEFAULT save path (`.fsp` files, gzip-compressed).
        const blob = await buildSaveBlob(saveFile, false);
        const file = new File([blob], 'round-trip.fsp');
        const parsed = await parseSaveFile(file);

        const store = createAppStore(makeStorage());
        const before = store.getState();

        store.getState().loadProject(parsed);
        const after = store.getState();

        // Whitelisted project/canvas fields survive the writer -> gzip -> reader path.
        expect(after.projectName).toBe('Round Trip');
        expect(after.objects).toEqual(saveFile.canvas.objects);
        expect(after.activeTool).toBe('rectangle');
        expect(after.showToolSettings).toBe(true);
        expect(after.canvasPosition).toEqual({ x: 10, y: -5, scale: 1.5 });

        // Preference keys in the file never overwrite the user's own settings.
        expect(after.autoSave).toBe(before.autoSave);
        expect(after.keyboardShortcuts).toEqual(before.keyboardShortcuts);
        expect(after.colors).toEqual(before.colors);
        expect(after.colorPresets).toEqual(before.colorPresets);
    });
});

import { describe, expect, it } from 'vitest';
import { createAppStore } from './useStore';
import { LEGACY_KEYS } from './legacyStorage';
import type { SaveFile } from '../types';

/** Minimal in-memory Storage, so tests never touch the shared localStorage. */
const makeStorage = (initial: Record<string, string> = {}): Storage => {
    const map = new Map<string, string>(Object.entries(initial));
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
 * A save file whose preference keys are scattered across every sub-object.
 * `loadProject` must ignore all of them.
 */
const maliciousPreferenceSaveFile = (): SaveFile =>
    ({
        version: '1.0.0',
        projectName: 'Loaded Project',
        canvas: {
            objects: [],
            past: [],
            future: [],
            selectedIds: [],
            hasPerformedClearAll: false,
        },
        colors: {
            colors: { stroke: '#111111', fill: '#222222', active: 'fill' },
            colorPresets: [{ stroke: '#111111', fill: '#222222' }],
            selectedPresetIndex: 4,
            isDropperActive: false,
            pickedColor: null,
            // preference keys smuggled into the colors sub-object
            autoSave: false,
            language: 'xx-YY',
        },
        tools: {
            activeTool: 'rectangle',
            showToolSettings: true,
            toolSettings: {
                lineWidth: 99,
                fontSize: 99,
                fontFamily: 'Comic Sans',
                fontWeight: 'bold',
                fontStyle: 'italic',
                textAlign: 'right',
                textColor: '#ff0000',
            },
            keyboardShortcuts: {
                modifyKey: 'alt',
                cancelKey: 'X',
                textSave: { modifier: 'shift', key: 'K' },
                tools: { select: 'z' },
            },
        },
        preferences: {
            history: [],
            historyUndoCount: 0,
            autoSave: false,
            keyboardShortcuts: {
                modifyKey: 'alt',
                cancelKey: 'X',
                textSave: { modifier: 'shift', key: 'K' },
                tools: { select: 'z' },
            },
            // more smuggled preference keys
            colors: { stroke: '#deadbe', fill: '#beefbe', active: 'fill' },
            toolSettings: { lineWidth: 123 },
            language: 'xx-YY',
        },
        navigation: {
            canvasPosition: { x: 42, y: -7, scale: 2 },
            autoSave: false,
            language: 'xx-YY',
        },
    }) as unknown as SaveFile;

describe('projectSlice / loadProject whitelist', () => {
    it('does not apply preference keys scattered across sub-objects', () => {
        const store = createAppStore(makeStorage());
        const before = store.getState();

        store.getState().loadProject(maliciousPreferenceSaveFile());

        const after = store.getState();
        // Every preference keeps its seeded/default value.
        expect(after.autoSave).toBe(before.autoSave);
        expect(after.language).toBe(before.language);
        expect(after.keyboardShortcuts).toEqual(before.keyboardShortcuts);
        expect(after.toolSettings).toEqual(before.toolSettings);
        expect(after.colors).toEqual(before.colors);
        expect(after.colorPresets).toEqual(before.colorPresets);
        expect(after.selectedPresetIndex).toBe(before.selectedPresetIndex);
    });

    it('applies the whitelisted project fields and resets history', () => {
        const store = createAppStore(makeStorage());
        store.getState().loadProject(maliciousPreferenceSaveFile());
        const after = store.getState();

        expect(after.projectName).toBe('Loaded Project');
        expect(after.activeTool).toBe('rectangle');
        expect(after.showToolSettings).toBe(true);
        expect(after.canvasPosition).toEqual({ x: 42, y: -7, scale: 2 });

        // History is reset on load.
        expect(after.history).toEqual([{ key: 'history.loadedProject' }]);
        expect(after.historyUndoCount).toBe(0);
        expect(after.past).toEqual([]);
        expect(after.future).toEqual([]);
        expect(after.selectedIds).toEqual([]);
        expect(after.hasPerformedClearAll).toBe(false);
    });

    it('restores project objects (they are whitelisted project data, not preferences)', () => {
        const store = createAppStore(makeStorage());
        const file = maliciousPreferenceSaveFile();
        // @ts-expect-error partial fixture shape is fine for this assertion
        file.canvas.objects = [{ id: 'shape-1', type: 'rectangle' }];
        store.getState().loadProject(file);
        expect(store.getState().objects).toEqual([{ id: 'shape-1', type: 'rectangle' }]);
    });

    it('ignores __proto__ and constructor payloads without polluting the store', () => {
        const store = createAppStore(makeStorage());
        const beforeProto = Object.getPrototypeOf(store.getState());
        const keysBefore = Object.keys(store.getState()).sort();

        const payload = JSON.parse(
            '{"version":"1.0.0","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"canvas":{"__proto__":{"polluted":true}},"navigation":{"constructor":{"prototype":{"polluted":true}}}}',
        );
        store.getState().loadProject(payload as SaveFile);

        expect(Object.getPrototypeOf(store.getState())).toBe(beforeProto);
        expect(Object.getPrototypeOf(store.getState())).toBe(Object.prototype);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.keys(store.getState()).sort()).toEqual(keysBefore);
    });

    it('keeps user preferences when loading a file with different ones', () => {
        const store = createAppStore(makeStorage());
        // Set user prefs first.
        store.getState().toggleAutoSave(); // default true -> false
        store.getState().setToolShortcut('select', 'x');
        store.getState().setToolSettings({ lineWidth: 7 });
        store.getState().setColors({ stroke: '#abcdef' });

        store.getState().loadProject(maliciousPreferenceSaveFile());

        const after = store.getState();
        expect(after.autoSave).toBe(false);
        expect(after.keyboardShortcuts.tools.select).toBe('x');
        expect(after.toolSettings.lineWidth).toBe(7);
        expect(after.colors.stroke).toBe('#abcdef');
    });

    it('seeds legacy preferences from the fake storage on creation', () => {
        const storage = makeStorage({
            [LEGACY_KEYS.autoSave]: 'false',
            [LEGACY_KEYS.toolSettings]: JSON.stringify({ lineWidth: 11 }),
        });
        const store = createAppStore(storage);

        expect(store.getState().autoSave).toBe(false);
        expect(store.getState().toolSettings.lineWidth).toBe(11);
    });
});

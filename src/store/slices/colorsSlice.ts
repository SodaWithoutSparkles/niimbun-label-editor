import type { StoreSlice } from '../storeTypes';
import { defaultColors, defaultColorPresets } from '../storeDefaults';
import { readJSON, STORAGE_KEYS, writeJSON } from '../storage';

export const createColorsSlice: StoreSlice = (set) => ({
    colors: readJSON(STORAGE_KEYS.colors, defaultColors),
    setColors: (colors) => set((state) => {
        const nextColors = { ...state.colors, ...colors };
        const shouldUpdateSelection =
            state.selectedIds.length > 0 &&
            (Object.prototype.hasOwnProperty.call(colors, 'stroke') || Object.prototype.hasOwnProperty.call(colors, 'fill'));

        if (!shouldUpdateSelection) {
            writeJSON(STORAGE_KEYS.colors, nextColors);
            return {
                colors: nextColors,
                selectedPresetIndex: null
            };
        }

        const idSet = new Set(state.selectedIds);
        writeJSON(STORAGE_KEYS.colors, nextColors);
        return {
            colors: nextColors,
            selectedPresetIndex: null,
            objects: state.objects.map((item) => (
                idSet.has(item.id)
                    ? {
                        ...item,
                        stroke: nextColors.stroke,
                        fill: nextColors.fill
                    }
                    : item
            )),
            past: [...state.past, state.objects],
            future: []
        };
    }),

    colorPresets: defaultColorPresets,
    addColorPreset: (preset) => set((state) => {
        if (state.colorPresets.length >= 8) return {};
        return { colorPresets: [...state.colorPresets, preset] };
    }),
    updateColorPreset: (index, updates) => set((state) => {
        if (index < 0 || index >= state.colorPresets.length) return {};
        const nextPresets = state.colorPresets.map((preset, i) => (
            i === index ? { ...preset, ...updates } : preset
        ));
        return { colorPresets: nextPresets };
    }),
    selectColorPreset: (index) => set((state) => {
        if (index < 0 || index >= state.colorPresets.length) return {};
        const preset = state.colorPresets[index];
        const nextColors = { ...state.colors, stroke: preset.stroke, fill: preset.fill };
        const shouldUpdateSelection = state.selectedIds.length > 0;

        if (!shouldUpdateSelection) {
            return {
                colors: nextColors,
                selectedPresetIndex: index
            };
        }

        const idSet = new Set(state.selectedIds);
        return {
            colors: nextColors,
            selectedPresetIndex: index,
            objects: state.objects.map((item) => (
                idSet.has(item.id)
                    ? {
                        ...item,
                        stroke: nextColors.stroke,
                        fill: nextColors.fill
                    }
                    : item
            )),
            past: [...state.past, state.objects],
            future: []
        };
    }),
    removeColorPreset: (index) => set((state) => {
        if (index < 0 || index >= state.colorPresets.length) return {};
        const newPresets = state.colorPresets.filter((_, i) => i !== index);
        return {
            colorPresets: newPresets,
            selectedPresetIndex: state.selectedPresetIndex === index ? null : state.selectedPresetIndex
        };
    }),
    selectedPresetIndex: null,

    isDropperActive: false,
    setDropperActive: (active) => set({ isDropperActive: active }),
    pickedColor: null,
    setPickedColor: (color) => set({ pickedColor: color }),
});

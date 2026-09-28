import type { AppState, ColorPreset, KeyboardShortcutConfig } from './storeTypes';

export const defaultKeyboardShortcuts: KeyboardShortcutConfig = {
    modifyKey: 'ctrl',
    cancelKey: 'Escape',
    textSave: {
        modifier: 'ctrl',
        key: 'Enter'
    },
    tools: {
        select: 's',
        rectangle: 'q',
        ellipse: 'w',
        line: 'e',
        arrow: 'a',
        callout: 'c',
        star: '1',
        text: 't',
        dropper: 'i'
    }
};

export const defaultToolSettings: AppState['toolSettings'] = {
    lineWidth: 2,
    fontSize: 24,
    fontFamily: 'Arial',
    fontWeight: 'normal',
    fontStyle: 'normal',
    textAlign: 'left',
    textColor: '#000000',
};

export const defaultColors: AppState['colors'] = { stroke: '#000000', fill: '#FFFFFFB2', active: 'stroke' };

export const defaultColorPresets: ColorPreset[] = [
    // stroke in RGB, fill in RGBA
    { stroke: '#000000', fill: '#FFFFFFB2' },
    { stroke: '#FF0000', fill: '#FFFFFFB2' },
    { stroke: '#FF0000', fill: '#FFFF00B2' },
    { stroke: '#0000FF', fill: '#FFFFFFB2' },
    { stroke: '#00FF00', fill: '#FFFFFFB2' },
    { stroke: '#FF00FF', fill: '#FFFFFFB2' },
    { stroke: '#00FFFF', fill: '#FFFFFFB2' },
];

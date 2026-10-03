import type { SupportedLanguage } from '../i18n/languages';
import type { AppState, ColorPreset, KeyboardShortcutConfig } from './storeTypes';

export const defaultAutoSave = true;

export const defaultLanguage: SupportedLanguage = 'en';

/**
 * Screen-density calibration (ui-spec.md §6/§11). CSS px per inch used by the
 * `real` zoom estimate. A machine/screen property, never document data. 96 is
 * the CSS reference PPI; browsers cannot report the true value.
 */
export const DEFAULT_SCREEN_DPI = 96;

export const SCREEN_DPI_MIN = 24;
export const SCREEN_DPI_MAX = 400;

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

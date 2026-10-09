import type { SupportedLanguage } from '../i18n/languages';
import type { AppState, KeyboardShortcutConfig } from './storeTypes';

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

/**
 * Preview grid spacing (ui-spec.md §6/§11) in hm (1/100 mm). 500 hm = 5 mm is a
 * comfortable drafting grid at label scale; purely a view aid, never document
 * data. Clamped to a sane 1–50 mm range so a corrupt blob cannot erase the grid.
 */
export const DEFAULT_GRID_SPACING_HM = 500;
export const GRID_SPACING_MIN_HM = 100;
export const GRID_SPACING_MAX_HM = 5000;

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
        text: 't'
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

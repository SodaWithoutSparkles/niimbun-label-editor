import type { SupportedLanguage } from '../i18n/languages';
import type { QuantizerDefaults } from '../core/render';
import type { AppState, ConnectMethod, DefaultQuantizerByType, KeyboardShortcutConfig } from './storeTypes';

export const defaultAutoSave = true;

/**
 * Print raster dpi preference (P2): render at the printer's reported dpi
 * (`PrinterInfo.resolutionClass`) when one is known, falling back to the
 * document's dpi hint. Default ON — a printer that reports its head dpi prints
 * at the correct physical scale. Persisted with the other global settings;
 * never document data.
 */
export const defaultUsePrinterDpi = true;

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

/**
 * Printer connect methods the chooser can remember, in display order
 * (ui-spec.md §11). Shared with the validation allow-list so the two cannot
 * drift; `capacitor-ble`/`virtual` are not offered in the browser.
 */
export const CONNECT_METHODS: readonly ConnectMethod[] = ['bluetooth', 'serial'];

/**
 * Default printer connect method — matches the reference
 * (`PrinterConnector.svelte`), which falls back to Bluetooth.
 */
export const DEFAULT_CONNECT_METHOD: ConnectMethod = 'bluetooth';

/**
 * Per-strategy dithering defaults. Empty on purpose: the engine's built-in
 * defaults (128 / 1 / true) apply, so an untouched install renders exactly as
 * before this setting existed.
 */
export const DEFAULT_QUANTIZER_DEFAULTS: QuantizerDefaults = {};

/**
 * Per-object-type default quantizer. Empty on purpose: `DEFAULT_POLICY_BY_TYPE`
 * (`core/render/policy`) remains the fallback for every type.
 */
export const DEFAULT_QUANTIZER_BY_TYPE: DefaultQuantizerByType = {};

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

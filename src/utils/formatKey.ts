/**
 * Display formatting for a stored keyboard binding. Shared by the settings
 * shortcuts section, the sidebar tool tooltips and the bottom bar so they all
 * render a binding identically: named keys map to translated key labels, a
 * single space renders as `Space`, a single character is upper-cased, and any
 * other named key keeps its casing (e.g. `Escape`).
 *
 * Takes the translator rather than importing i18n so the key labels stay in the
 * catalogue and update when the language changes. Accepts `unknown` on purpose:
 * it is called on values read from persisted storage, and a non-string must
 * degrade to `''` rather than crash render.
 */
type Translator = (key: 'keyLabels.ctrl' | 'keyLabels.alt' | 'keyLabels.shift' | 'keyLabels.esc' | 'keyLabels.space') => string;

export const formatKey = (key: unknown, t: Translator): string => {
    if (typeof key !== 'string' || key === '') return '';
    const lower = key.toLowerCase();
    if (lower === 'ctrl') return t('keyLabels.ctrl');
    if (lower === 'alt') return t('keyLabels.alt');
    if (lower === 'shift') return t('keyLabels.shift');
    if (lower === 'escape') return t('keyLabels.esc');
    if (key === ' ') return t('keyLabels.space');
    return key.length === 1 ? key.toUpperCase() : key;
};

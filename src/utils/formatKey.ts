/**
 * Display formatting for a stored keyboard binding. Shared by the settings
 * shortcuts section and the sidebar tool tooltips so they agree: a single space
 * renders as `Space`, a single character is upper-cased, and a named key keeps
 * its casing (e.g. `Escape`).
 *
 * Accepts `unknown` on purpose: it is called on values read from persisted
 * storage, and a non-string must degrade to `''` rather than crash render.
 */
export const formatKey = (key: unknown): string => {
    if (typeof key !== 'string') return '';
    if (key === ' ') return 'Space';
    if (key.length === 1) return key.toUpperCase();
    return key;
};

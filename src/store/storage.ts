const isBrowser = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const STORAGE_KEYS = {
    keyboardShortcuts: 'ui_keyboard_shortcuts',
    autoSave: 'ui_auto_save',
    toolSettings: 'ui_tool_settings',
    colors: 'ui_colors'
};

export const readJSON = <T extends Record<string, any>>(key: string, fallback: T): T => {
    if (!isBrowser) return fallback;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return fallback;
        return { ...fallback, ...parsed };
    } catch {
        return fallback;
    }
};

export const readBoolean = (key: string, fallback: boolean): boolean => {
    if (!isBrowser) return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'boolean' ? parsed : fallback;
    } catch {
        return fallback;
    }
};

export const writeJSON = (key: string, value: unknown) => {
    if (!isBrowser) return;
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // ignore storage errors
    }
};

export const writeBoolean = (key: string, value: boolean) => {
    if (!isBrowser) return;
    try {
        localStorage.setItem(key, value ? 'true' : 'false');
    } catch {
        // ignore storage errors
    }
};

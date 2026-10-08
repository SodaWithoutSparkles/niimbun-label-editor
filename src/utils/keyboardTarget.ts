/**
 * True when a key event targets a text-entry control — an `input`, `textarea`
 * or any `contenteditable` element. Global keydown handlers must bail on these
 * so typing never triggers a canvas/editor shortcut (Enter/Esc included).
 * Shared by the editor shortcut layer and the preview's polygon keys.
 */
export const isTypingTarget = (event: KeyboardEvent): boolean => {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
};

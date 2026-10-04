import { useEffect } from 'react';
import { useStore } from '../../store/useStore';

/**
 * Global shortcuts that must work in both the gallery and the editor.
 *
 * Mounted above the view switch (app root). Only `Ctrl/Cmd+,` today: it opens
 * the settings window. The editor's own `EditorKeyboardShortcuts` bails on
 * inputs and open dialogs, so it cannot own a gallery-global binding; this
 * handler keeps the `dialog[open]` bail so it never stacks a second dialog.
 */
export const GlobalShortcuts = () => {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (document.querySelector('dialog[open]')) return;
            const mod = event.ctrlKey || event.metaKey;
            if (mod && event.key === ',') {
                event.preventDefault();
                useStore.getState().openSettings();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    return null;
};

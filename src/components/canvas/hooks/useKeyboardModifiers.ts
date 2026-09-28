import { useState, useEffect } from 'react';

type ModifierKey = 'ctrl' | 'alt' | 'shift';

const modifierKeyMap: Record<ModifierKey, string> = {
    ctrl: 'Control',
    alt: 'Alt',
    shift: 'Shift'
};

export const useKeyboardModifiers = (modifierKey: ModifierKey) => {
    const [isModifierPressed, setIsModifierPressed] = useState(false);

    useEffect(() => {
        const expectedKey = modifierKeyMap[modifierKey];

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === expectedKey) {
                setIsModifierPressed(true);
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === expectedKey) {
                setIsModifierPressed(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [modifierKey]);

    return { isModifierPressed };
};

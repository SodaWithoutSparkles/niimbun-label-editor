import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { GlobalShortcuts } from './GlobalShortcuts';

const press = (key: string, init: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

describe('GlobalShortcuts', () => {
    beforeEach(() => {
        useStore.setState({ isSettingsOpen: false, view: 'gallery' });
        render(<GlobalShortcuts />);
    });
    afterEach(() => {
        cleanup();
        useStore.setState({ isSettingsOpen: false, view: 'gallery' });
    });

    it('opens settings from the gallery', () => {
        press(',', { ctrlKey: true });
        expect(useStore.getState().isSettingsOpen).toBe(true);
    });

    it('bails while a modal dialog is open', () => {
        const dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        document.body.appendChild(dialog);

        press(',', { ctrlKey: true });

        expect(useStore.getState().isSettingsOpen).toBe(false);
        dialog.remove();
    });
});

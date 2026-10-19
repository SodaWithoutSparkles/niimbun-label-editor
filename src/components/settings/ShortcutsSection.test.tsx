// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { defaultKeyboardShortcuts } from '../../store/storeDefaults';
import { ShortcutsSection } from './ShortcutsSection';

/**
 * The View group (dithered-view key). The capture field is the same
 * `ShortcutInput` idiom as the tool shortcuts, so one test proves the wiring:
 * the current key renders, and the next captured key is persisted.
 */

afterEach(() => {
    cleanup();
    useStore.setState({ keyboardShortcuts: defaultKeyboardShortcuts });
});

describe('ShortcutsSection — dithered view', () => {
    it('renders the View group with the default key and a hold description', () => {
        render(<ShortcutsSection />);

        expect(screen.getByText('Quantized view')).toBeTruthy();
        expect(screen.getByText(/hold to peek/i)).toBeTruthy();
        expect(screen.getByDisplayValue('Q')).toBeTruthy();
    });

    it('persists a captured view key', () => {
        render(<ShortcutsSection />);

        fireEvent.keyDown(screen.getByDisplayValue('Q'), { key: 'v' });

        expect(useStore.getState().keyboardShortcuts.quantizedView).toBe('v');
        // The field re-renders with the new binding.
        expect(screen.getByDisplayValue('V')).toBeTruthy();
        // The tool map is untouched.
        expect(useStore.getState().keyboardShortcuts.tools.rectangle).toBe('r');
    });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { GeneralSection } from './GeneralSection';

afterEach(() => {
    cleanup();
    useStore.setState({ screenDpi: 96 });
});

describe('GeneralSection screen DPI', () => {
    it('does not clamp while typing; blur commits the clamped value once', () => {
        render(<GeneralSection />);
        const input = screen.getByRole('spinbutton') as HTMLInputElement;

        // Clearing the field leaves the committed value untouched.
        fireEvent.change(input, { target: { value: '' } });
        expect(input.value).toBe('');
        expect(useStore.getState().screenDpi).toBe(96);

        // An out-of-range draft is still not committed on change.
        fireEvent.change(input, { target: { value: '9' } });
        expect(useStore.getState().screenDpi).toBe(96);

        // Blur applies the store's clamp (min 24) exactly once.
        fireEvent.blur(input);
        expect(useStore.getState().screenDpi).toBe(24);
        expect(input.value).toBe('24');
    });

    it('commits on Enter', () => {
        render(<GeneralSection />);
        const input = screen.getByRole('spinbutton') as HTMLInputElement;

        fireEvent.change(input, { target: { value: '150' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(useStore.getState().screenDpi).toBe(150);
    });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { GeneralSection } from './GeneralSection';
import { SettingsModal } from './SettingsModal';

afterEach(() => {
    cleanup();
    // Reset for the next test; every test that assumes 96 seeds it explicitly.
    useStore.setState({ screenDpi: 96 });
});

describe('GeneralSection screen DPI', () => {
    it('does not clamp while typing; blur commits the clamped value once', () => {
        useStore.setState({ screenDpi: 96 });
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
        useStore.setState({ screenDpi: 96 });
        render(<GeneralSection />);
        const input = screen.getByRole('spinbutton') as HTMLInputElement;

        fireEvent.change(input, { target: { value: '150' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(useStore.getState().screenDpi).toBe(150);
    });
});

describe('GeneralSection calibration dialog (P7 #11)', () => {
    it('keeps the dialog unmounted until Calibrate is pressed', () => {
        useStore.setState({ screenDpi: 96 });
        render(<GeneralSection />);

        expect(screen.queryByText('Screen DPI calibration')).toBeNull();
        expect(screen.queryByTestId('calibration-ruler')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));

        expect(screen.getByText('Screen DPI calibration')).toBeTruthy();
        expect(screen.getByTestId('calibration-ruler')).toBeTruthy();
    });

    it('unmounts the dialog again on close', () => {
        useStore.setState({ screenDpi: 96 });
        render(<GeneralSection />);

        fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));
        // By text, not accessible name: the header X carries the same label.
        fireEvent.click(screen.getByText('Close'));

        expect(screen.queryByTestId('calibration-ruler')).toBeNull();
    });

    it('drives the shared store value from the dialog', () => {
        useStore.setState({ screenDpi: 96 });
        render(<GeneralSection />);
        fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));

        fireEvent.change(screen.getByRole('slider'), { target: { value: '120' } });

        expect(useStore.getState().screenDpi).toBe(120);
        // The raw field re-renders from the store, so the two never disagree.
        expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('120');
    });

    it('opens stacked on the Settings modal', () => {
        // LIMITATION: happy-dom has no top layer and no `inert`, so this pins
        // only that the calibration dialog mounts and its controls work while
        // nested inside the Settings modal. Real stacking, inertness and focus
        // need the owner's browser pass (see agent/memory/dialogs.md).
        useStore.setState({ screenDpi: 96 });
        render(<SettingsModal open onClose={vi.fn()} />);

        expect(screen.queryByTestId('calibration-ruler')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Calibrate' }));

        // Both dialogs are open in the top layer at once.
        expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
        expect(screen.getByText('Settings')).toBeTruthy();
        expect(screen.getByText('Screen DPI calibration')).toBeTruthy();
        fireEvent.change(screen.getByRole('slider'), { target: { value: '160' } });
        expect(useStore.getState().screenDpi).toBe(160);
    });
});

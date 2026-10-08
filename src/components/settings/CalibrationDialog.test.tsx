// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { SCREEN_DPI_MAX, SCREEN_DPI_MIN } from '../../store/storeDefaults';
import { CalibrationDialog } from './CalibrationDialog';

afterEach(() => {
    cleanup();
    // Reset for the next test; every test that assumes 96 seeds it explicitly.
    useStore.setState({ screenDpi: 96 });
});

/** The ruler's rendered width, i.e. `100 mm * dpi / 25.4`. */
const rulerWidthPx = () =>
    (screen.getByTestId('calibration-ruler') as HTMLElement).style.width;

const slider = () => screen.getByRole('slider') as HTMLInputElement;

describe('CalibrationDialog (P7 #11)', () => {
    it('sizes the 100 mm ruler as mm * dpi / 25.4', () => {
        useStore.setState({ screenDpi: 96 });
        render(<CalibrationDialog open onClose={vi.fn()} />);
        // 100 * 96 / 25.4 = 377.9527... px
        expect(rulerWidthPx()).toBe('377.95px');
    });

    it('grows the ruler as the DPI rises', () => {
        useStore.setState({ screenDpi: 192 });
        render(<CalibrationDialog open onClose={vi.fn()} />);
        expect(rulerWidthPx()).toBe('755.91px');
    });

    it('writes the store live when the slider moves', () => {
        useStore.setState({ screenDpi: 96 });
        render(<CalibrationDialog open onClose={vi.fn()} />);

        fireEvent.change(slider(), { target: { value: '144' } });

        expect(useStore.getState().screenDpi).toBe(144);
        // The ruler follows the committed value with no local copy to go stale.
        expect(rulerWidthPx()).toBe('566.93px');
        expect(slider().value).toBe('144');
    });

    it('honours the store clamp on an out-of-range nudge', () => {
        useStore.setState({ screenDpi: SCREEN_DPI_MIN });
        render(<CalibrationDialog open onClose={vi.fn()} />);

        // One step below the floor: the store clamps, the slider re-renders at it.
        fireEvent.click(screen.getByRole('button', { name: 'Decrease DPI' }));
        expect(useStore.getState().screenDpi).toBe(SCREEN_DPI_MIN);

        useStore.getState().setScreenDpi(SCREEN_DPI_MAX);
        fireEvent.change(slider(), { target: { value: String(SCREEN_DPI_MAX) } });
        fireEvent.click(screen.getByRole('button', { name: 'Increase DPI' }));
        expect(useStore.getState().screenDpi).toBe(SCREEN_DPI_MAX);
    });

    it('labels the ruler and the live value for screen readers', () => {
        useStore.setState({ screenDpi: 96 });
        render(<CalibrationDialog open onClose={vi.fn()} />);
        expect(screen.getByRole('img', { name: 'Calibration ruler, 100 mm' })).toBeTruthy();
        expect(screen.getByText('Current DPI: 96')).toBeTruthy();
        expect(screen.getByText('100 mm reference')).toBeTruthy();
    });

    it('announces the slider value with its unit, not as a bare number', () => {
        useStore.setState({ screenDpi: 96 });
        render(<CalibrationDialog open onClose={vi.fn()} />);
        expect(slider().getAttribute('aria-valuetext')).toBe('96 DPI');

        fireEvent.change(slider(), { target: { value: '144' } });
        expect(slider().getAttribute('aria-valuetext')).toBe('144 DPI');
    });

    it('closes on the footer button without an OK/confirm step', () => {
        useStore.setState({ screenDpi: 96 });
        const onClose = vi.fn();
        render(<CalibrationDialog open onClose={onClose} />);

        // By text, not accessible name: the header X shares the same label.
        fireEvent.click(screen.getByText('Close'));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('slides within the store bounds', () => {
        useStore.setState({ screenDpi: 96 });
        render(<CalibrationDialog open onClose={vi.fn()} />);
        expect(slider().min).toBe(String(SCREEN_DPI_MIN));
        expect(slider().max).toBe(String(SCREEN_DPI_MAX));
    });
});
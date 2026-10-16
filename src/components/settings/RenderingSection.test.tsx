// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { RenderingSection } from './RenderingSection';
import { SettingsModal } from './SettingsModal';

afterEach(() => {
    cleanup();
    // Reset for the next test; every test that assumes a value seeds it.
    useStore.setState({ quantizerDefaults: {}, defaultQuantizerByType: {} });
});

const spinbutton = (name: RegExp) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
const toggle = (name: RegExp) => screen.getByRole('switch', { name }) as HTMLButtonElement;

describe('RenderingSection — per-strategy defaults', () => {
    it('shows the engine default threshold and does not write while typing', () => {
        useStore.setState({ quantizerDefaults: {} });
        render(<RenderingSection />);
        const input = spinbutton(/^threshold$/i);

        expect(input.value).toBe('128');

        // Clearing / an out-of-range draft never reaches the store.
        fireEvent.change(input, { target: { value: '' } });
        expect(input.value).toBe('');
        expect(useStore.getState().quantizerDefaults).toEqual({});

        fireEvent.change(input, { target: { value: '200' } });
        expect(useStore.getState().quantizerDefaults).toEqual({});

        // Blur commits exactly once.
        fireEvent.blur(input);
        expect(useStore.getState().quantizerDefaults).toEqual({ threshold: { threshold: 200 } });
    });

    it('clamps a committed threshold to [0,255] and reflects the clamped value', () => {
        useStore.setState({ quantizerDefaults: {} });
        render(<RenderingSection />);
        const input = spinbutton(/^threshold$/i);

        fireEvent.change(input, { target: { value: '300' } });
        fireEvent.blur(input);

        expect(useStore.getState().quantizerDefaults.threshold?.threshold).toBe(255);
        expect(input.value).toBe('255');
    });

    it('reverts an unparseable threshold draft on blur', () => {
        useStore.setState({ quantizerDefaults: { threshold: { threshold: 90 } } });
        render(<RenderingSection />);
        const input = spinbutton(/^threshold$/i);
        expect(input.value).toBe('90');

        fireEvent.change(input, { target: { value: 'abc' } });
        fireEvent.blur(input);

        expect(useStore.getState().quantizerDefaults).toEqual({ threshold: { threshold: 90 } });
        expect(input.value).toBe('90');
    });

    it('commits an Error diffusion value on Enter, clamped to [0,4]', () => {
        useStore.setState({ quantizerDefaults: {} });
        render(<RenderingSection />);
        const input = spinbutton(/floyd/i);
        expect(input.value).toBe('1');

        fireEvent.change(input, { target: { value: '2.5' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(useStore.getState().quantizerDefaults.floydSteinberg).toEqual({ strength: 2.5 });

        fireEvent.change(input, { target: { value: '9' } });
        fireEvent.blur(input);
        expect(useStore.getState().quantizerDefaults.floydSteinberg).toEqual({ strength: 4 });
    });

    it('toggles serpentine, defaulting to on and storing an explicit boolean', () => {
        useStore.setState({ quantizerDefaults: {} });
        render(<RenderingSection />);
        const sw = toggle(/floyd/i);

        // Engine default serpentine is `true`.
        expect(sw.getAttribute('aria-checked')).toBe('true');

        fireEvent.click(sw);
        expect(useStore.getState().quantizerDefaults.floydSteinberg).toEqual({ serpentine: false });

        fireEvent.click(sw);
        expect(useStore.getState().quantizerDefaults.floydSteinberg).toEqual({ serpentine: true });
    });

    it('reflects a stored serpentine value', () => {
        useStore.setState({ quantizerDefaults: { stucki: { serpentine: false } } });
        render(<RenderingSection />);
        expect(toggle(/stucki/i).getAttribute('aria-checked')).toBe('false');
    });

    it('offers the Error diffusion + serpentine controls for every diffuser only', () => {
        render(<RenderingSection />);
        for (const name of [/floyd/i, /stucki/i, /atkinson/i]) {
            expect(spinbutton(name)).toBeTruthy();
            expect(toggle(name)).toBeTruthy();
        }
        // `threshold` uses the single Threshold knob, never a diffusion control.
        expect(screen.queryByRole('spinbutton', { name: /threshold error diffusion/i })).toBeNull();
    });
});

describe('RenderingSection — per-object-type default quantizer', () => {
    it('lists a select per policy type, defaulting to the theme option', () => {
        useStore.setState({ defaultQuantizerByType: {} });
        render(<RenderingSection />);

        for (const label of ['Text', 'Image', 'QR', 'Barcode', '2D code']) {
            const select = screen.getByRole('combobox', { name: label }) as HTMLSelectElement;
            expect(select.value).toBe('');
        }
        // The empty option is the type default (not a stored id).
        expect(screen.getAllByRole('option', { name: 'Type default' })).toHaveLength(5);
        // Shapes deliberately have no policy, so no select is offered.
        expect(screen.queryByRole('combobox', { name: 'Shape' })).toBeNull();
    });

    it('writes the chosen id and clears back to the type default', () => {
        useStore.setState({ defaultQuantizerByType: {} });
        render(<RenderingSection />);
        const select = screen.getByRole('combobox', { name: 'Image' }) as HTMLSelectElement;

        fireEvent.change(select, { target: { value: 'atkinson' } });
        expect(useStore.getState().defaultQuantizerByType).toEqual({ image: 'atkinson' });

        fireEvent.change(select, { target: { value: '' } });
        expect(useStore.getState().defaultQuantizerByType).toEqual({});
    });

    it('reflects a stored type override', () => {
        useStore.setState({ defaultQuantizerByType: { text: 'stucki' } });
        render(<RenderingSection />);
        expect((screen.getByRole('combobox', { name: 'Text' }) as HTMLSelectElement).value).toBe(
            'stucki',
        );
    });
});

describe('SettingsModal registers the Rendering section', () => {
    it('shows the section content when its sidebar entry is picked', () => {
        render(<SettingsModal open onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Rendering' }));

        expect(screen.getByRole('spinbutton', { name: /^threshold$/i })).toBeTruthy();
        expect(screen.getByRole('combobox', { name: 'Image' })).toBeTruthy();
    });
});

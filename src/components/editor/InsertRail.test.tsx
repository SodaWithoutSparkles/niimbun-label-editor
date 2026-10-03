import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { InsertRail } from './InsertRail';

afterEach(() => {
    cleanup();
    useStore.getState().clearActiveTool();
});

describe('InsertRail', () => {
    it('arms a one-shot action and disarms on a second click', () => {
        render(<InsertRail />);
        const text = screen.getByRole('button', { name: 'Text' });
        fireEvent.click(text);
        expect(useStore.getState().activeTool).toBe('text');
        expect(text.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(text);
        expect(useStore.getState().activeTool).toBe('select');
    });

    it('arms a shape variant from the Shape menu', () => {
        render(<InsertRail />);
        fireEvent.click(screen.getByRole('button', { name: 'Shape' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rectangle' }));
        expect(useStore.getState().activeTool).toBe('shape:rectangle');
    });

    it('disables the engines that are not available yet', () => {
        render(<InsertRail />);
        expect((screen.getByRole('button', { name: 'Image' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'QR' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Barcode' }) as HTMLButtonElement).disabled).toBe(true);
    });
});

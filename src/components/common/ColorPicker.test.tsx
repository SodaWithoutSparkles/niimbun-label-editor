// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { ColorPicker } from './ColorPicker';

/**
 * P10 W3 (D4): same portal + legibility fix as PopoverSlider, anchored to the
 * colour swatch. `menuAlign="right"` (the ObjectTab usage) aligns the panel's
 * right edge to the swatch's right edge.
 */

const rect = (left: number, top: number, right: number, bottom: number): DOMRect =>
    ({
        x: left,
        y: top,
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        toJSON: () => ({}),
    }) as DOMRect;

const panel = () => screen.getByTestId('color-picker-panel');
const queryPanel = () => screen.queryByTestId('color-picker-panel');

/** The swatch trigger, below the component root (which carries the ref). */
const swatch = (container: HTMLElement) => container.firstElementChild?.firstElementChild as HTMLElement;

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ColorPicker portal', () => {
    it('renders the panel into <body>, outside the scroll container', () => {
        render(
            <div data-testid="scroll-clip" style={{ overflowY: 'auto', height: '100px' }}>
                <ColorPicker color="#FF0000" onChange={() => {}} />
            </div>,
        );
        const clip = screen.getByTestId('scroll-clip');

        expect(queryPanel()).toBeNull();

        fireEvent.click(swatch(screen.getByTestId('scroll-clip')));

        const p = panel();
        expect(clip.contains(p)).toBe(false);
        expect(p.parentElement).toBe(document.body);
        // Visibility fix: light text on the dark panel surface.
        expect(p.className).toContain('text-gray-100');
        expect(p.className).toContain('fixed');
        expect(p.className).not.toContain('absolute');
    });

    it('right-aligns the panel to the swatch for menuAlign="right"', () => {
        const { container } = render(<ColorPicker color="#FF0000" onChange={() => {}} menuAlign="right" />);
        const root = container.firstElementChild as HTMLElement;
        root.getBoundingClientRect = () => rect(500, 20, 524, 44);

        fireEvent.click(swatch(container));

        expect(panel().style.left).toBe('524px');
        expect(panel().style.top).toBe('48px');
        expect(panel().style.transform).toBe('translateX(-100%)');
    });

    it('left-aligns the panel to the swatch by default', () => {
        const { container } = render(<ColorPicker color="#FF0000" onChange={() => {}} />);
        const root = container.firstElementChild as HTMLElement;
        root.getBoundingClientRect = () => rect(200, 20, 224, 44);

        fireEvent.click(swatch(container));

        expect(panel().style.left).toBe('200px');
        expect(panel().style.transform).toBe('none');
    });

    it('closes on outside mousedown but stays open for clicks inside the panel', () => {
        const { container } = render(<ColorPicker color="#FF0000" onChange={() => {}} />);
        fireEvent.click(swatch(container));
        expect(panel()).toBeInTheDocument();

        fireEvent.mouseDown(panel());
        expect(panel()).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(queryPanel()).toBeNull();
    });

    it('closes on Escape without leaking the key to the window-level editor handlers', () => {
        const { container } = render(<ColorPicker color="#FF0000" onChange={() => {}} />);
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        fireEvent.click(swatch(container));
        fireEvent.keyDown(document.body, { key: 'Escape' });

        window.removeEventListener('keydown', onWindowKeyDown);
        expect(queryPanel()).toBeNull();
        expect(onWindowKeyDown).not.toHaveBeenCalled();
    });

    it('survives StrictMode double-mount with a single panel and working dismissal', () => {
        const { container } = render(
            <StrictMode>
                <ColorPicker color="#FF0000" onChange={() => {}} />
            </StrictMode>,
        );

        fireEvent.click(swatch(container));
        expect(screen.getAllByTestId('color-picker-panel')).toHaveLength(1);

        fireEvent.mouseDown(document.body);
        expect(queryPanel()).toBeNull();
    });

    it('flips the panel above the swatch when it does not fit below', () => {
        const { container } = render(<ColorPicker color="#FF0000" onChange={() => {}} />);
        const root = container.firstElementChild as HTMLElement;
        const vh = window.innerHeight;
        root.getBoundingClientRect = () => rect(200, vh - 200, 224, vh - 180);

        fireEvent.click(swatch(container));
        // ColorPicker's gap is 4 px (the old `mt-1`).
        expect(panel().style.top).toBe(`${vh - 176}px`);

        Object.defineProperty(panel(), 'offsetHeight', { value: 400, configurable: true });
        fireEvent.scroll(window);

        expect(panel().style.top).toBe(`${vh - 200 - 4 - 400}px`);
        expect(panel().style.maxHeight).toBe(`${vh - 200 - 4 - 8}px`);
    });
});

// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { PopoverSlider } from './PopoverSlider';

/**
 * P10 W3 (D4): the popover is portalled to <body> so the MFP panel's
 * `overflow-y-auto` cannot clip it, is anchored to the trigger's viewport rect,
 * and keeps its outside-click / Escape / StrictMode behaviour.
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

const panel = () => screen.getByTestId('popover-slider-panel');
const queryPanel = () => screen.queryByTestId('popover-slider-panel');

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('PopoverSlider portal', () => {
    it('renders the panel into <body>, outside the scroll container', () => {
        render(
            <div data-testid="scroll-clip" style={{ overflowY: 'auto', height: '100px' }}>
                <PopoverSlider value={5} onChange={() => {}} />
            </div>,
        );
        const clip = screen.getByTestId('scroll-clip');

        expect(queryPanel()).toBeNull();

        fireEvent.click(screen.getByText('5'));

        const p = panel();
        expect(clip.contains(p)).toBe(false);
        expect(p.parentElement).toBe(document.body);
        // Visibility fix: light text on the dark panel surface.
        expect(p.className).toContain('text-gray-100');
        expect(p.className).toContain('fixed');
    });

    it('anchors the panel below the trigger from its viewport rect', () => {
        const { container } = render(<PopoverSlider value={5} onChange={() => {}} />);
        const root = container.firstElementChild as HTMLElement;
        root.getBoundingClientRect = () => rect(100, 50, 140, 70);

        fireEvent.click(screen.getByText('5'));

        // center: left = 100 + width/2 = 120; top = bottom(70) + gap(8).
        expect(panel().style.left).toBe('120px');
        expect(panel().style.top).toBe('78px');
        expect(panel().style.transform).toBe('translateX(-50%)');
    });

    it('repositions while the window scrolls instead of closing', () => {
        const { container } = render(<PopoverSlider value={5} onChange={() => {}} />);
        const root = container.firstElementChild as HTMLElement;
        let left = 100;
        root.getBoundingClientRect = () => rect(left, 50, left + 40, 70);

        fireEvent.click(screen.getByText('5'));
        expect(panel().style.left).toBe('120px');

        left = 300;
        fireEvent.scroll(window);
        expect(panel().style.left).toBe('320px');
    });

    it('closes on outside mousedown but stays open for clicks inside the panel', () => {
        render(<PopoverSlider value={5} onChange={() => {}} label="Size" />);
        fireEvent.click(screen.getByText('5'));
        expect(panel()).toBeInTheDocument();

        // Inside the portalled panel is still "inside" for dismissal purposes.
        fireEvent.mouseDown(panel());
        expect(panel()).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(queryPanel()).toBeNull();
    });

    it('closes on Escape without leaking the key to the window-level editor handlers', () => {
        render(<PopoverSlider value={5} onChange={() => {}} />);
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        fireEvent.click(screen.getByText('5'));
        fireEvent.keyDown(document.body, { key: 'Escape' });

        window.removeEventListener('keydown', onWindowKeyDown);
        expect(queryPanel()).toBeNull();
        expect(onWindowKeyDown).not.toHaveBeenCalled();
    });

    it('closes on Escape while the panel input owns focus', () => {
        render(<PopoverSlider value={5} onChange={() => {}} />);
        fireEvent.click(screen.getByText('5'));

        fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Escape' });

        expect(queryPanel()).toBeNull();
    });

    it('focuses the number input when the panel opens', () => {
        render(<PopoverSlider value={5} onChange={() => {}} />);

        fireEvent.click(screen.getByText('5'));

        const input = screen.getByRole('spinbutton') as HTMLInputElement;
        expect(document.activeElement).toBe(input);
        // Caret at the end where the browser supports it (number inputs may not).
        if (input.selectionStart !== null) {
            expect(input.selectionStart).toBe(input.value.length);
        }
    });

    it('focuses the input on open under StrictMode without a duplicate panel', () => {
        render(
            <StrictMode>
                <PopoverSlider value={5} onChange={() => {}} />
            </StrictMode>,
        );

        fireEvent.click(screen.getByText('5'));

        expect(screen.getAllByTestId('popover-slider-panel')).toHaveLength(1);
        expect(document.activeElement).toBe(screen.getByRole('spinbutton'));
    });

    it('survives StrictMode double-mount with a single panel and working dismissal', () => {
        render(
            <StrictMode>
                <PopoverSlider value={5} onChange={() => {}} />
            </StrictMode>,
        );

        fireEvent.click(screen.getByText('5'));
        expect(screen.getAllByTestId('popover-slider-panel')).toHaveLength(1);

        fireEvent.mouseDown(document.body);
        expect(queryPanel()).toBeNull();

        // Reopen still works after the StrictMode replay.
        fireEvent.click(screen.getByText('5'));
        expect(screen.getAllByTestId('popover-slider-panel')).toHaveLength(1);
    });

    it('flips the panel above the trigger when it does not fit below', () => {
        const { container } = render(<PopoverSlider value={5} onChange={() => {}} />);
        const root = container.firstElementChild as HTMLElement;
        const vh = window.innerHeight;
        // A trigger 200 px above the viewport bottom: 400 px of panel cannot fit
        // below, but there is room above.
        root.getBoundingClientRect = () => rect(100, vh - 200, 140, vh - 180);

        fireEvent.click(screen.getByText('5'));
        expect(panel().style.top).toBe(`${vh - 172}px`);

        // happy-dom reports `offsetHeight` as 0; give the mounted panel a tall
        // height and let the scroll re-measure flip it above the trigger.
        Object.defineProperty(panel(), 'offsetHeight', { value: 400, configurable: true });
        fireEvent.scroll(window);

        expect(panel().style.top).toBe(`${vh - 200 - 8 - 400}px`);
        // Capped to the room above the trigger so it can never overflow.
        expect(panel().style.maxHeight).toBe(`${vh - 200 - 8 - 8}px`);
    });
});

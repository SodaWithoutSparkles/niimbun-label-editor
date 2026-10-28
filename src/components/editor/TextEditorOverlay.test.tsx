// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { installCanvasShim } from '../../test/canvasHarness';
import { measureKonvaText } from '../../editor/render/textMetrics';
import type { LabelDoc, Node } from '../../core/doc/types';
import {
    CARET_WIDTH_RATIO,
    TextEditorOverlay,
    caretFromPoint,
    caretRectForOffset,
    computeScreenPlacement,
    localPointOf,
    wrappedLineStarts,
    useTextEditor,
    type CaretFont,
    type TextEditorSession,
} from './TextEditorOverlay';

const textNode = (over: Record<string, unknown> = {}): Node =>
    ({
        id: 't',
        parentId: null,
        type: 'text',
        text: { kind: 'static', value: 'hello' },
        visible: true,
        locked: false,
        transform: { x: 100, y: 200, rotDeg: 15, scaleX: 1, scaleY: 1 },
        size: { w: 2000, h: 1000 },
        fontSize: 300,
        fontFamily: 'sans-serif',
        fontStyle: 'normal',
        align: 'left',
        lineHeight: 1,
        ...over,
    }) as unknown as Node;

const makeDoc = (nodes: Node[]): LabelDoc =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });

beforeEach(() => {
    installCanvasShim();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useStore.setState({
        currentDoc: null,
        selectedNodeIds: [],
        docPast: [],
        docFuture: [],
        effectiveZoom: 1,
    });
});

describe('computeScreenPlacement', () => {
    it('reads an identity matrix as no rotation and the raw screen origin', () => {
        expect(computeScreenPlacement([1, 0, 0, 1, 30, 40])).toEqual({
            screenX: 30,
            screenY: 40,
            rotation: 0,
        });
    });

    it('reads a rotate-90 matrix as 90°', () => {
        const z = 2;
        const placement = computeScreenPlacement([0, z, -z, 0, 100, 200]);
        expect(placement.screenX).toBeCloseTo(100, 6);
        expect(placement.screenY).toBeCloseTo(200, 6);
        expect(placement.rotation).toBeCloseTo(90, 6);
    });

    it('adds the gutter offsets to the matrix origin', () => {
        const placement = computeScreenPlacement([1, 0, 0, 1, 5, 7], 24, 24);
        expect(placement.screenX).toBeCloseTo(29, 6);
        expect(placement.screenY).toBeCloseTo(31, 6);
    });
});

describe('localPointOf', () => {
    it('inverts translation', () => {
        expect(localPointOf([1, 0, 0, 1, 100, 200], 130, 240)).toEqual({ x: 30, y: 40 });
    });

    it('inverts scale', () => {
        expect(localPointOf([2, 0, 0, 2, 0, 0], 40, 100)).toEqual({ x: 20, y: 50 });
    });

    it('round-trips a rotated+scaled+translated matrix (inverse of the forward map)', () => {
        // Forward: p' = M·p. For any p, localPointOf(M, forward(p)) === p.
        const m = [2 * Math.cos(0.5), 2 * Math.sin(0.5), -2 * Math.sin(0.5), 2 * Math.cos(0.5), 100, 200] as const;
        const forward = (x: number, y: number) => ({
            x: m[0] * x + m[2] * y + m[4],
            y: m[1] * x + m[3] * y + m[5],
        });
        for (const [x, y] of [
            [0, 0],
            [50, 20],
            [-13, 7],
        ] as const) {
            const screen = forward(x, y);
            const back = localPointOf(m, screen.x, screen.y);
            expect(back.x).toBeCloseTo(x, 6);
            expect(back.y).toBeCloseTo(y, 6);
        }
    });

    it('is degenerate-safe for a singular matrix', () => {
        expect(localPointOf([0, 0, 0, 0, 0, 0], 5, 5)).toEqual({ x: 0, y: 0 });
    });
});

// 10 px per char so the caret math is exact and readable.
const ctx = { measureText: (t: string) => ({ width: t.length * 10 }), font: '' } as unknown as CanvasRenderingContext2D;
const font: CaretFont = { fontSize: 10, fontFamily: 'sans-serif', fontStyle: 'normal', lineHeight: 1 };

describe('wrappedLineStarts', () => {
    it('splits on hard newlines', () => {
        expect(wrappedLineStarts(ctx, 'ab\ncde', 500, font, 'word')).toEqual([0, 3]);
    });

    it('soft-wraps at a space (word mode)', () => {
        // "hello world" at contentWidth 70: "hello " fits (60), "world" wraps → [0,6].
        expect(wrappedLineStarts(ctx, 'hello world', 70, font, 'word')).toEqual([0, 6]);
    });

    it('soft-wraps per character when no space exists', () => {
        expect(wrappedLineStarts(ctx, 'abcdef', 25, font, 'word')).toEqual([0, 2, 4]);
    });

    it('makes progress for a single char wider than the line', () => {
        expect(wrappedLineStarts(ctx, 'ab', 5, font, 'char')).toEqual([0, 1, 2]);
    });
});

describe('caretFromPoint', () => {
    it('maps a click inside a line to the nearest character boundary', () => {
        expect(caretFromPoint(ctx, 'hello', 34, 5, 500, font, 'word', 'left')).toBe(3);
        expect(caretFromPoint(ctx, 'hello', 41, 5, 500, font, 'word', 'left')).toBe(4);
    });

    it('clamps to the line bounds', () => {
        expect(caretFromPoint(ctx, 'hello', -50, 5, 500, font, 'word', 'left')).toBe(0);
        expect(caretFromPoint(ctx, 'hello', 9999, 5, 500, font, 'word', 'left')).toBe(5);
    });

    it('maps a click on a later hard line to the right offset', () => {
        expect(caretFromPoint(ctx, 'ab\ncde', 20, 15, 500, font, 'word', 'left')).toBe(5);
    });

    it('accounts for center alignment', () => {
        // "hello" width 50 in a 500 box → origin 225.
        expect(caretFromPoint(ctx, 'hello', 225, 5, 500, font, 'word', 'center')).toBe(0);
        expect(caretFromPoint(ctx, 'hello', 249, 5, 500, font, 'word', 'center')).toBe(2);
    });

    it('maps a click on a soft-wrapped line', () => {
        // "hello world" wraps after "hello " (70) → line 1 starts at 6 ("world").
        // Click x=20 on line 1 → col 2 → offset 8.
        expect(caretFromPoint(ctx, 'hello world', 20, 15, 70, font, 'word', 'left')).toBe(8);
    });
});

describe('caretRectForOffset', () => {
    it('places the caret after the prefix on the clicked line', () => {
        expect(caretRectForOffset(ctx, 'hello', 3, 500, font, 'word', 'left')).toEqual({ left: 30, top: 0, height: 10 });
        expect(caretRectForOffset(ctx, 'ab\ncde', 5, 500, font, 'word', 'left')).toEqual({ left: 20, top: 10, height: 10 });
    });

    it('places the caret at the line end', () => {
        expect(caretRectForOffset(ctx, 'hello', 5, 500, font, 'word', 'left')).toEqual({ left: 50, top: 0, height: 10 });
    });

    it('offsets the caret for right alignment', () => {
        expect(caretRectForOffset(ctx, 'hello', 0, 500, font, 'word', 'right').left).toBe(450);
    });

    it('places the caret on a soft-wrapped line', () => {
        // "hello world" wraps at 70 → line 1 (offset 6) top = 10, "world" starts at x 0.
        expect(caretRectForOffset(ctx, 'hello world', 6, 70, font, 'word', 'left')).toEqual({
            left: 0,
            top: 10,
            height: 10,
        });
    });
});

/** A precomputed placement handed to `begin`; the hook stores it verbatim. */
const sessionArgs: Omit<TextEditorSession, 'text'> = {
    id: 't',
    screenX: 10,
    screenY: 20,
    unscaledWidth: 400,
    unscaledHeight: 200,
    rotation: 15,
    scaleX: 1,
    scaleY: 1,
    fontSize: 300,
    fontFamily: 'sans-serif',
    fontStyle: 'normal',
    lineHeight: 1,
    align: 'left',
    clickLocalX: 12,
    clickLocalY: 22,
};

describe('useTextEditor', () => {
    it('begin opens a session from the supplied placement and the node text', () => {
        useStore.setState({ currentDoc: makeDoc([textNode()]) });
        const { result } = renderHook(() => useTextEditor());

        act(() => result.current.begin(sessionArgs));

        expect(result.current.editing).toMatchObject({ ...sessionArgs, text: 'hello' });
    });

    it('begin ignores a non-static (csv) text source', () => {
        useStore.setState({
            currentDoc: makeDoc([textNode({ text: { kind: 'csv', column: 'col', fallback: '' } })]),
        });
        const { result } = renderHook(() => useTextEditor());

        act(() => result.current.begin(sessionArgs));

        expect(result.current.editing).toBeNull();
    });

    it('setText writes a static text patch through updateNodeTransient', () => {
        useStore.setState({ currentDoc: makeDoc([textNode()]) });
        const transient = vi.spyOn(useStore.getState(), 'updateNodeTransient');
        const { result } = renderHook(() => useTextEditor());

        act(() => result.current.begin(sessionArgs));
        act(() => result.current.setText('world'));

        expect(result.current.editing?.text).toBe('world');
        expect(transient).toHaveBeenCalledWith('t', { text: { kind: 'static', value: 'world' } });
    });

    it('cancel restores the pre-edit snapshot via restoreDoc, dropping the session', () => {
        useStore.setState({ currentDoc: makeDoc([textNode()]) });
        const restore = vi.spyOn(useStore.getState(), 'restoreDoc');
        const { result } = renderHook(() => useTextEditor());

        act(() => result.current.begin(sessionArgs));
        act(() => result.current.setText('world'));
        act(() => result.current.cancel());

        expect(result.current.editing).toBeNull();
        expect(restore).toHaveBeenCalledTimes(1);
        const restored = restore.mock.calls[0]![0];
        const node = restored.nodes.find((entry) => entry.id === 't')!;
        expect(node.type === 'text' && node.text).toEqual({ kind: 'static', value: 'hello' });
    });

    it('commit ends the session with one undo entry', () => {
        useStore.setState({ currentDoc: makeDoc([textNode()]) });
        const { result } = renderHook(() => useTextEditor());

        act(() => result.current.begin(sessionArgs));
        act(() => result.current.setText('world'));
        act(() => result.current.commit());

        expect(result.current.editing).toBeNull();
        expect(useStore.getState().docPast).toHaveLength(1);
    });
});

const session: TextEditorSession = {
    id: 't',
    screenX: 10,
    screenY: 20,
    unscaledWidth: 200,
    unscaledHeight: 100,
    rotation: 0,
    scaleX: 2,
    scaleY: 3,
    fontSize: 300,
    fontFamily: 'sans-serif',
    fontStyle: 'normal',
    lineHeight: 1,
    align: 'left',
    text: 'hello',
    clickLocalX: 0,
    clickLocalY: 0,
};

const overlay = (props: Partial<ComponentProps<typeof TextEditorOverlay>> = {}) => (
    <TextEditorOverlay
        session={session}
        wrap="word"
        onChange={() => {}}
        onCommit={() => {}}
        onCancel={() => {}}
        {...props}
    />
);

describe('TextEditorOverlay', () => {
    it('Escape cancels, Ctrl+Enter commits, plain Enter does not commit', () => {
        const onCommit = vi.fn();
        const onCancel = vi.fn();
        render(overlay({ onCommit, onCancel }));
        const textarea = screen.getByRole('textbox');

        fireEvent.keyDown(textarea, { key: 'Enter' });
        expect(onCommit).not.toHaveBeenCalled();

        fireEvent.keyDown(textarea, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
        expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it('blur commits and change forwards the text', () => {
        const onCommit = vi.fn();
        const onChange = vi.fn();
        render(overlay({ onCommit, onChange }));
        const textarea = screen.getByRole('textbox');

        fireEvent.change(textarea, { target: { value: 'world' } });
        expect(onChange).toHaveBeenCalledWith('world');

        fireEvent.blur(textarea);
        expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it('places the transform on the wrapper and lays the box out unscaled', () => {
        render(overlay());
        const wrapper = screen.getByTestId('text-editor-wrapper') as HTMLElement;
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

        expect(wrapper.style.transform).toBe('rotate(0deg) scale(2, 3)');
        expect(wrapper.style.left).toBe('10px');
        expect(wrapper.style.top).toBe('20px');
        expect(wrapper.style.width).toBe('200px');
        expect(wrapper.style.height).toBe('100px');
        // The textarea fills the wrapper and carries no transform of its own.
        expect(textarea.style.transform).toBe('');
        expect(textarea.style.caretColor).toBe('transparent');
        expect(textarea.style.fontSize).toBe('300px');
    });

    it('rotates the wrapper by the session rotation', () => {
        render(overlay({ session: { ...session, rotation: 90 } }));
        const wrapper = screen.getByTestId('text-editor-wrapper') as HTMLElement;
        expect(wrapper.style.transform).toBe('rotate(90deg) scale(2, 3)');
    });

    it('renders the synthetic caret inside the wrapper (layout px)', () => {
        render(overlay());
        const caret = screen.getByTestId('text-editor-caret') as HTMLElement;
        // 300px font x 5% x scaleX 2 = 30 device px -> 15 layout px.
        expect(caret.style.width).toBe(`${300 * CARET_WIDTH_RATIO}px`);
        expect(caret.style.animation).toContain('text-editor-caret-blink');
        // Position is layout px inside the transformed wrapper (never pre-scaled).
        const left = parseFloat(caret.style.left);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(left).toBeLessThanOrEqual(session.unscaledWidth);
    });

    it('keeps a caret for an empty box', () => {
        render(overlay({ session: { ...session, text: '' } }));
        expect(screen.getByTestId('text-editor-caret')).toBeTruthy();
    });

    // The caret is sized in layout px but the wrapper transform scales it, so the
    // bar must be rounded in *device* space to stay whole pixels at any zoom.
    const caretWidthAt = (scaleX: number): number => {
        render(overlay({ session: { ...session, scaleX } }));
        return parseFloat((screen.getByTestId('text-editor-caret') as HTMLElement).style.width);
    };

    it('rounds the caret to whole device pixels', () => {
        // 300px font x 5% x 1.3 scale = 19.5 device px -> 20.
        expect(caretWidthAt(1.3) * 1.3).toBeCloseTo(20);
    });

    it('never thins the caret below one device pixel when zoomed out', () => {
        // 300px font x 5% x 0.05 scale = 0.75 device px -> clamped to 1.
        expect(caretWidthAt(0.05) * 0.05).toBeCloseTo(1);
    });

    it('scales the caret rounding with devicePixelRatio', () => {
        // happy-dom exposes devicePixelRatio as a settable accessor.
        const original = window.devicePixelRatio;
        window.devicePixelRatio = 2;
        try {
            // deviceScale = 0.05 x 2 = 0.1: 300 x 5% x 0.1 = 1.5 device px -> 2,
            // i.e. 2 / 0.1 = 20 layout px.
            expect(caretWidthAt(0.05)).toBeCloseTo(20);
        } finally {
            window.devicePixelRatio = original;
        }
    });

    // `session` is 200x100 with a 300px font and 'hello': it cannot fit, so
    // `shrink` is well below 1 in every real measurement of this box.
    it('scales an overflowing shrink text inside an inner box', () => {
        render(overlay({ wrap: 'shrink' }));
        const inner = screen.getByTestId('text-editor-inner') as HTMLElement;
        const match = /scale\(([^)]+)\)/.exec(inner.style.transform);
        expect(match).not.toBeNull();
        const shrink = Number(match![1]);
        expect(shrink).toBeGreaterThan(0);
        expect(shrink).toBeLessThan(1);
        expect(inner.style.transformOrigin).toBe('top left');
        // Width is the **node box** — the natural wrap width Konva measured.
        // Height is `node.h / shrink`, so every natural line exists before the
        // single scale is applied (a `node.h` box would clip them first).
        expect(parseFloat(inner.style.width)).toBeCloseTo(session.unscaledWidth, 6);
        expect(parseFloat(inner.style.height)).toBeCloseTo(session.unscaledHeight / shrink, 6);
        // Visible block: `node.w × shrink` wide, up to `node.h` tall.
        expect(parseFloat(inner.style.width) * shrink).toBeCloseTo(session.unscaledWidth * shrink, 6);
        expect(parseFloat(inner.style.width) * shrink).toBeLessThan(session.unscaledWidth);
        expect(parseFloat(inner.style.height) * shrink).toBeCloseTo(session.unscaledHeight, 6);
        // The textarea keeps its natural font size and no transform of its own.
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea.style.fontSize).toBe('300px');
        expect(textarea.style.transform).toBe('');
        expect(textarea.style.width).toBe('100%');
        // The wrapper is still the node's true box (no scale baked into it).
        const wrapper = screen.getByTestId('text-editor-wrapper') as HTMLElement;
        expect(wrapper.style.width).toBe('200px');
        expect(wrapper.style.height).toBe('100px');
    });

    it('keeps the caret bar on whole device pixels at a shrink < 1', () => {
        // A shorter box overflows harder (shrink < 1) but keeps the same font.
        const dpr = window.devicePixelRatio || 1;
        const plain = render(overlay());
        const plainWidth = parseFloat((screen.getByTestId('text-editor-caret') as HTMLElement).style.width);
        plain.unmount();

        render(overlay({ session: { ...session, unscaledHeight: 40 }, wrap: 'shrink' }));
        const inner = screen.getByTestId('text-editor-inner') as HTMLElement;
        const shrink = Number(/scale\(([^)]+)\)/.exec(inner.style.transform)![1]);
        expect(shrink).toBeGreaterThan(0);
        expect(shrink).toBeLessThan(1);
        const layoutWidth = parseFloat((screen.getByTestId('text-editor-caret') as HTMLElement).style.width);
        // The inner box scales the bar too, so the pre-fix formula (which
        // ignored `shrink`) gives a different layout width for this session.
        expect(layoutWidth).not.toBe(plainWidth);
        // The painted width in device px is `layout × shrink × scaleX × dpr`:
        // a whole number of pixels and never below one.
        const devicePx = layoutWidth * shrink * session.scaleX * dpr;
        expect(devicePx).toBeCloseTo(Math.round(devicePx), 6);
        expect(devicePx).toBeGreaterThanOrEqual(1);
    });

    it('applies the node letterSpacing to the textarea (and omits it at 0)', () => {
        const spaced = render(overlay({ session: { ...session, letterSpacing: 2 } }));
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).style.letterSpacing).toBe('2px');
        spaced.unmount();

        render(overlay());
        // Unset at 0/undefined: the pre-fix DOM is byte-identical.
        expect((screen.getByRole('textbox') as HTMLTextAreaElement).style.letterSpacing).toBe('');
    });

    it('wraps the shrink text at the natural node width (Konva parity)', () => {
        // `shrinkScaleOf` measures Konva at `width = node.w` with the natural
        // font; the textarea must wrap in that same space. `contentWidth` is
        // `ta.clientWidth` (the full-width textarea = the inner box = node.w),
        // and `wrappedLineStarts` is the overlay's own layout model, so the two
        // line counts must agree. A `box / shrink` inner box would wrap less.
        const ctx2d = document.createElement('canvas').getContext('2d');
        expect(ctx2d).not.toBeNull();
        const caretFont: CaretFont = {
            fontSize: session.fontSize,
            fontFamily: session.fontFamily,
            fontStyle: session.fontStyle,
            lineHeight: session.lineHeight,
        };
        const konvaLines =
            measureKonvaText({
                text: session.text,
                width: session.unscaledWidth,
                height: session.unscaledHeight,
                fontSize: session.fontSize,
                fontFamily: session.fontFamily,
                fontStyle: session.fontStyle,
                wrap: 'word',
                lineHeight: session.lineHeight,
            }).height /
            (session.fontSize * session.lineHeight);
        expect(konvaLines).toBeGreaterThan(1);
        expect(wrappedLineStarts(ctx2d!, session.text, session.unscaledWidth, caretFont, 'word')).toHaveLength(
            Math.round(konvaLines),
        );

        render(overlay({ wrap: 'shrink' }));
        const inner = screen.getByTestId('text-editor-inner') as HTMLElement;
        const shrink = Number(/scale\(([^)]+)\)/.exec(inner.style.transform)![1]);
        // The renderer's box is the wrap width `wrappedLineStarts` just used
        // (textarea is `width: 100%` of it).
        expect(parseFloat(inner.style.width)).toBeCloseTo(session.unscaledWidth, 6);
        // Dividing it by the shrink (the old, wrong geometry) would wrap wider.
        expect(
            wrappedLineStarts(ctx2d!, session.text, session.unscaledWidth / shrink, caretFont, 'word').length,
        ).toBeLessThan(Math.round(konvaLines));
    });

    it('leaves a fitting shrink text at its natural layout (no inner box)', () => {
        // 10px font in a 200x100 box: it fits, so shrink === 1 and the DOM is
        // the pre-fix one — no inner box, no transform, natural layout px.
        render(overlay({ session: { ...session, text: 'hi', fontSize: 10 }, wrap: 'shrink' }));
        expect(screen.queryByTestId('text-editor-inner')).toBeNull();
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea.style.transform).toBe('');
        expect(textarea.style.fontSize).toBe('10px');
        // Caret geometry is unchanged in layout px: the seed click is the node
        // origin, so the bar sits at the top-left and is one line tall.
        const caret = screen.getByTestId('text-editor-caret') as HTMLElement;
        expect(caret.style.left).toBe('0px');
        expect(caret.style.top).toBe('0px');
        expect(caret.style.height).toBe('10px');
    });
});

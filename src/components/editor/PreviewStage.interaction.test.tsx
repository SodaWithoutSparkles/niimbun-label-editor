// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import Konva from 'konva';
import '../../i18n';
import { installCanvasShim } from '../../test/canvasHarness';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node, TextNode } from '../../core/doc/types';
import { PreviewStage } from './PreviewStage';
import { centeredViewport, ZOOM_MAX } from '../../editor/viewportController';
import type { InsertAction } from '../../store/slices/toolsSlice';

/**
 * Interaction coverage for the polygon draw mode (#7). The stage is mounted for
 * real on the canvas shim; Konva events are fired directly on the Stage instance
 * (the same path React-Konva's `on*` props listen on), so the assertions read
 * the actual store (`doc.nodes`, `docPast`, `activeTool`) rather than a helper.
 *
 * `happy-dom` has no layout, so the container's client box is fixed here to give
 * the fit-to-viewport math a realistic (non-degenerate) zoom.
 */

beforeAll(() => {
    installCanvasShim();
    // Fixed pane size: without layout every `clientWidth` is 0 and the fit zoom
    // collapses, mapping every click to a clamped corner.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
});

const makeDoc = () =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 4000, backingH: 3000 });

const mount = () => {
    useStore.setState({
        view: 'editor',
        currentDoc: makeDoc(),
        selectedNodeIds: [],
        activeTool: 'shape:polygon',
        snapEnabled: false,
    });
    render(<PreviewStage />);
    const stage = Konva.stages[Konva.stages.length - 1] as Konva.Stage;
    if (!stage) throw new Error('PreviewStage did not mount a Konva stage');
    return stage;
};

interface FireOptions {
    detail?: number;
    button?: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
}

/** Fire one pointer event at pane position (x, y) on the mounted stage. */
const firePointer = (stage: Konva.Stage, type: string, x: number, y: number, opts: FireOptions = {}) => {
    const evt = {
        clientX: x,
        clientY: y,
        button: opts.button ?? 0,
        detail: opts.detail ?? 1,
        shiftKey: opts.shiftKey ?? false,
        ctrlKey: opts.ctrlKey ?? false,
        metaKey: opts.metaKey ?? false,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
    };
    stage.setPointersPositions(evt as unknown as PointerEvent);
    act(() => {
        stage.fire(type, { evt: evt as unknown as PointerEvent, target: stage });
    });
};

/** World (hm) → pane screen coordinates, via the mounted content layer. */
const toScreen = (stage: Konva.Stage, x: number, y: number): { x: number; y: number } => {
    const layer = stage.getLayers().at(-1)!;
    return layer.getAbsoluteTransform().point({ x, y });
};

beforeEach(() => {
    useStore.setState({ docPast: [], docFuture: [] });
});

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, activeTool: 'select', selectedNodeIds: [] });
});

describe('PreviewStage polygon draw mode (#7)', () => {
    it('accumulates vertices without creating a node until the draft finishes', () => {
        const stage = mount();

        firePointer(stage, 'pointerdown', 100, 100);
        firePointer(stage, 'pointerdown', 300, 120);
        firePointer(stage, 'pointerdown', 200, 300);

        expect(useStore.getState().currentDoc?.nodes).toHaveLength(0);
        expect(useStore.getState().activeTool).toBe('shape:polygon');
    });

    it('finishes a double-click into exactly one polygon and one undo entry, with no spike vertex', () => {
        const stage = mount();

        // Three clicks then a double-click (pointerdown detail 1 → detail 2,
        // then dblclick). The detail-2 pointerdown must not append a vertex —
        // the two clicks are a few px apart so, without the guard, a sliver
        // spike would survive adjacent-duplicate dedupe.
        firePointer(stage, 'pointerdown', 100, 100);
        firePointer(stage, 'pointerdown', 300, 120);
        firePointer(stage, 'pointerdown', 200, 300);
        firePointer(stage, 'pointerdown', 320, 260, { detail: 1 });
        firePointer(stage, 'pointerdown', 323, 263, { detail: 2 });
        firePointer(stage, 'dblclick', 323, 263, { detail: 2 });

        const state = useStore.getState();
        expect(state.currentDoc?.nodes).toHaveLength(1);
        expect(state.docPast).toHaveLength(1);
        const node = state.currentDoc!.nodes[0]!;
        // 4 real vertices: the double-click added one, not two (no sliver spike).
        expect(node.type === 'shape' && node.points).toHaveLength(4);
        expect(state.activeTool).toBe('select');
    });

    it('clamps clicks in the grey surround to the label backing (no out-of-label vertex)', () => {
        const stage = mount();

        // Click outside the label on every side; each lands on the backing edge.
        firePointer(stage, 'pointerdown', 5, 100);
        firePointer(stage, 'pointerdown', 595, 100);
        firePointer(stage, 'pointerdown', 300, 500);
        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        });

        const node = useStore.getState().currentDoc!.nodes[0]!;
        expect(node.type).toBe('shape');
        const pts = node.type === 'shape' ? node.points! : [];
        const xs = pts.map(([x]) => x);
        const ys = pts.map(([, y]) => y);
        expect(node.transform.x + Math.min(...xs)).toBeGreaterThanOrEqual(0);
        expect(node.transform.x + Math.max(...xs)).toBeLessThanOrEqual(4000);
        expect(node.transform.y + Math.max(...ys)).toBeLessThanOrEqual(3000);
    });

    it('keeps middle-drag panning alive mid-draft (must-fix #2)', () => {
        const stage = mount();
        firePointer(stage, 'pointerdown', 100, 100); // start a draft

        const before = stage.getLayers().at(-1)!.x();
        firePointer(stage, 'pointerdown', 300, 300, { button: 1 }); // arm pan
        firePointer(stage, 'pointermove', 360, 300); // drag right

        // The viewport pan moved the scene layer; without the reorder the
        // polygon cursor branch would return before the pan branch.
        expect(stage.getLayers().at(-1)!.x()).toBeGreaterThan(before);
    });

    it('cancels the draft and disarms the tool on Escape', () => {
        const stage = mount();

        firePointer(stage, 'pointerdown', 100, 100);
        firePointer(stage, 'pointerdown', 300, 120);

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        });

        const state = useStore.getState();
        expect(state.currentDoc?.nodes).toHaveLength(0);
        expect(state.activeTool).toBe('select');
    });

    it('drops the polygon draft when the gesture is cancelled', () => {
        const stage = mount();
        firePointer(stage, 'pointerdown', 100, 100);
        firePointer(stage, 'pointerdown', 300, 120);

        // The dashed draft preview lives on the content (last) layer.
        const draftLines = () => stage.getLayers().at(-1)!.find('Line').length;
        expect(draftLines()).toBeGreaterThan(0);

        act(() => {
            window.dispatchEvent(new Event('pointercancel'));
        });

        // The draft is gone; cancelling does not disarm the tool.
        expect(draftLines()).toBe(0);
        expect(useStore.getState().activeTool).toBe('shape:polygon');
    });

    it('finishes the draft on Enter', () => {
        const stage = mount();

        firePointer(stage, 'pointerdown', 100, 100);
        firePointer(stage, 'pointerdown', 300, 120);
        firePointer(stage, 'pointerdown', 200, 300);

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        });

        const state = useStore.getState();
        expect(state.currentDoc?.nodes).toHaveLength(1);
        expect(state.activeTool).toBe('select');
    });

    it('ignores Enter/Esc while the user is typing in a text input', () => {
        const stage = mount();
        firePointer(stage, 'pointerdown', 100, 100);
        firePointer(stage, 'pointerdown', 300, 120);
        firePointer(stage, 'pointerdown', 200, 300);
        useStore.setState({ selectedNodeIds: ['keep-me'] });

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        });
        input.remove();

        const state = useStore.getState();
        expect(state.currentDoc?.nodes).toHaveLength(0);
        expect(state.activeTool).toBe('shape:polygon');
        expect(state.selectedNodeIds).toEqual(['keep-me']);
    });
});

/**
 * Bug 1 regression: Konva's Transformer mutates the selected node's own
 * `scaleX`/`scaleY` in place and never resets them. On the commit re-render
 * react-konva skips re-applying the unchanged `scaleX: 1` prop (strict mode
 * off), so without the explicit reset the node keeps the gesture scale `k` and
 * renders at `base·k²` (rect lands past the pointer, text goes "wide putin",
 * QR group distorts).
 */
describe('PreviewStage resize commit resets the Konva node scale (Bug 1)', () => {
    const rectangleNode = (): Node => ({
        id: 'r',
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1000, h: 800 },
    });

    const mountSelectedRect = () => {
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({
                id: 'doc-1',
                now: 1_700_000_000,
                backingW: 4000,
                backingH: 3000,
                nodes: [rectangleNode()],
            }),
            selectedNodeIds: ['r'],
            activeTool: 'select',
            snapEnabled: false,
        });
        render(<PreviewStage />);
        const stage = Konva.stages[Konva.stages.length - 1] as Konva.Stage;
        if (!stage) throw new Error('PreviewStage did not mount a Konva stage');
        return stage;
    };

    it('restores the node scale to 1 while committing one undo entry', () => {
        const stage = mountSelectedRect();
        const transformer = stage.findOne('Transformer') as Konva.Transformer;
        expect(transformer).toBeTruthy();
        // The attached node is the selected rect (the Transformer only hosts
        // anchor Rects, so this is unambiguous).
        const rect = transformer.nodes()[0] as Konva.Rect;
        expect(rect, 'the Transformer must attach to the selected rect').toBeTruthy();

        act(() => {
            // Mimic the post-drag state: Konva leaves its live scale on the node.
            rect.scaleX(1.5);
            rect.scaleY(1.5);
            transformer.fire('transformstart', {});
            transformer.fire('transformend', {});
        });

        // With the fix the node's own scale is reset, so the committed
        // geometry is the only source of size. Without it, react-konva skips
        // the unchanged `scaleX: 1` prop and this stays 1.5.
        expect(rect.scaleX()).toBe(1);
        expect(rect.scaleY()).toBe(1);

        const state = useStore.getState();
        const node = state.currentDoc!.nodes.find((entry) => entry.id === 'r')!;
        expect(node.size).toEqual({ w: 1500, h: 1200 });
        expect(node.transform.scaleX).toBe(1);
        expect(node.transform.scaleY).toBe(1);
        expect(state.docPast).toHaveLength(1);
    });

    it('preserves a vertical flip sign while baking the magnitude into the box', () => {
        const stage = mountSelectedRect();
        const transformer = stage.findOne('Transformer') as Konva.Transformer;
        const rect = transformer.nodes()[0] as Konva.Rect;

        act(() => {
            // A realistic vertical flip: Konva's `Util.decompose` never yields a
            // negative `scaleX`, so only `scaleY` carries the sign.
            rect.scaleY(-1.5);
            transformer.fire('transformstart', {});
            transformer.fire('transformend', {});
        });

        // The reset collapses the live scale to its sign (-1), not to +1.
        expect(rect.scaleY()).toBe(-1);

        const state = useStore.getState();
        const node = state.currentDoc!.nodes.find((entry) => entry.id === 'r')!;
        expect(node.size).toEqual({ w: 1000, h: 1200 });
        expect(node.transform.scaleY).toBe(-1);
        expect(node.transform.scaleX).toBe(1);
    });

    it('restores the committed scale when a transform is cancelled (no transformend)', () => {
        const stage = mountSelectedRect();
        const transformer = stage.findOne('Transformer') as Konva.Transformer;
        const rect = transformer.nodes()[0] as Konva.Rect;

        act(() => {
            // Mimic a live gesture: Konva leaves its scale on the node.
            rect.scaleX(1.5);
            rect.scaleY(1.5);
            transformer.fire('transformstart', {});
        });
        expect(rect.scaleX()).toBe(1.5);

        act(() => {
            // Konva's Transformer only binds move/up events, so `pointercancel`
            // never fires `transformend`; the cancel path must clean up itself.
            window.dispatchEvent(new Event('pointercancel'));
        });

        expect(rect.scaleX()).toBe(1);
        expect(rect.scaleY()).toBe(1);

        const state = useStore.getState();
        const node = state.currentDoc!.nodes.find((entry) => entry.id === 'r')!;
        expect(node.size).toEqual({ w: 1000, h: 800 });
        expect(state.docPast).toHaveLength(0);
    });

    it('restores the committed scale when the window loses focus mid-transform (OS mouse steal)', () => {
        const stage = mountSelectedRect();
        const transformer = stage.findOne('Transformer') as Konva.Transformer;
        const rect = transformer.nodes()[0] as Konva.Rect;

        act(() => {
            // Mimic a live gesture: Konva leaves its scale on the node.
            rect.scaleX(1.5);
            rect.scaleY(1.5);
            transformer.fire('transformstart', {});
        });
        expect(rect.scaleX()).toBe(1.5);

        act(() => {
            // Win+Shift+S (and friends) steals the mouse: no `mouseup` and no
            // `pointercancel` arrives, so the window `blur` must abort the live
            // transform and revert to the committed doc — no commit.
            window.dispatchEvent(new Event('blur'));
        });

        expect(rect.scaleX()).toBe(1);
        expect(rect.scaleY()).toBe(1);

        const state = useStore.getState();
        const node = state.currentDoc!.nodes.find((entry) => entry.id === 'r')!;
        expect(node.size).toEqual({ w: 1000, h: 800 });
        expect(state.docPast).toHaveLength(0);
    });

    it('reverts through the real stopTransform → transformend route on blur', () => {
        const stage = mountSelectedRect();
        const transformer = stage.findOne('Transformer') as Konva.Transformer;
        const rect = transformer.nodes()[0] as Konva.Rect;

        act(() => {
            // Mimic a live gesture and force Konva's internal flag so
            // `stopTransform()` really fires `transformend` synchronously. This
            // exercises the `abortingRef` branch of `handleTransformEnd`; the
            // manual `transformstart` above leaves `_transforming` false, so
            // that path is otherwise never reached (the fallback revert runs).
            rect.scaleX(1.5);
            rect.scaleY(1.5);
            transformer.fire('transformstart', {});
            (transformer as unknown as { _transforming: boolean })._transforming = true;
        });
        expect(rect.scaleX()).toBe(1.5);

        act(() => {
            window.dispatchEvent(new Event('blur'));
        });

        // The abort branch reverted to the committed doc and never committed the
        // abandoned live scale.
        expect(rect.scaleX()).toBe(1);
        expect(rect.scaleY()).toBe(1);

        const state = useStore.getState();
        const node = state.currentDoc!.nodes.find((entry) => entry.id === 'r')!;
        expect(node.size).toEqual({ w: 1000, h: 800 });
        expect(state.docPast).toHaveLength(0);
    });

    it('reverts through the real stopTransform → transformend route when the tab is hidden', () => {
        const stage = mountSelectedRect();
        const transformer = stage.findOne('Transformer') as Konva.Transformer;
        const rect = transformer.nodes()[0] as Konva.Rect;

        act(() => {
            rect.scaleX(1.5);
            rect.scaleY(1.5);
            transformer.fire('transformstart', {});
            (transformer as unknown as { _transforming: boolean })._transforming = true;
        });

        try {
            act(() => {
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
                document.dispatchEvent(new Event('visibilitychange'));
            });

            expect(rect.scaleX()).toBe(1);
            expect(rect.scaleY()).toBe(1);

            const state = useStore.getState();
            const node = state.currentDoc!.nodes.find((entry) => entry.id === 'r')!;
            expect(node.size).toEqual({ w: 1000, h: 800 });
            expect(state.docPast).toHaveLength(0);
        } finally {
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        }
    });
});

/**
 * Phase 3 selection & resize semantics:
 * - item 1: corners-only anchors for a single aspect-default node.
 * - item 4: multi-selection drag preserves the selection; a no-move click collapses.
 * - item 6: text live-resize is box-only (glyphs constant, live == commit).
 */
describe('PreviewStage P3 selection & resize semantics', () => {
    const rectNode = (id: string, x: number, y: number): Node => ({
        id,
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1000, h: 1000 },
    });

    const qrNode = (id: string): Node => ({
        id,
        parentId: null,
        type: 'qr',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1000, h: 1000 },
        data: { kind: 'static', value: 'payload' },
    });

    const textNode = (id: string): Node => ({
        id,
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1000, h: 500 },
        text: { kind: 'static', value: 'hello world' },
        fontSize: 300,
    });

    const mountSelection = (nodes: Node[], selected: string[]) => {
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 4000, backingH: 3000, nodes }),
            selectedNodeIds: selected,
            activeTool: 'select',
            snapEnabled: false,
        });
        render(<PreviewStage />);
        const stage = Konva.stages[Konva.stages.length - 1] as Konva.Stage;
        if (!stage) throw new Error('PreviewStage did not mount a Konva stage');
        return stage;
    };

    describe('item 1 — corners-only anchors for aspect-default nodes', () => {
        it('shows only the four corners for a single QR selection', () => {
            const stage = mountSelection([qrNode('q')], ['q']);
            const transformer = stage.findOne('Transformer') as Konva.Transformer;
            expect(transformer.enabledAnchors()).toEqual([
                'top-left',
                'top-right',
                'bottom-left',
                'bottom-right',
            ]);
        });

        it('keeps all eight anchors for a single text selection (free resize)', () => {
            const stage = mountSelection([textNode('t')], ['t']);
            const transformer = stage.findOne('Transformer') as Konva.Transformer;
            expect(transformer.enabledAnchors()).toHaveLength(8);
            expect(transformer.enabledAnchors()).toContain('middle-left');
        });

        it('switches the anchor set when the selection changes qr → text in one mounted component', () => {
            const stage = mountSelection([qrNode('q'), textNode('t')], ['q']);
            const transformer = stage.findOne('Transformer') as Konva.Transformer;
            // A single qr is aspect-default: corners only.
            expect(transformer.enabledAnchors()).toHaveLength(4);

            act(() => {
                useStore.setState({ selectedNodeIds: ['t'] });
            });

            // Text is free: all eight anchors. The `undefined` prop must reset
            // Konva's default rather than stick at the previous four.
            expect(transformer.enabledAnchors()).toHaveLength(8);
            expect(transformer.enabledAnchors()).toContain('middle-left');
        });

        it('keeps free resize (eight anchors, no ratio lock) for a mixed selection', () => {
            const stage = mountSelection([qrNode('q'), rectNode('r', 3000, 0)], ['q', 'r']);
            const transformer = stage.findOne('Transformer') as Konva.Transformer;
            expect(transformer.enabledAnchors()).toHaveLength(8);
            expect(transformer.keepRatio()).toBe(false);
        });
    });

    describe('item 4 — preserve multi-selection on drag', () => {
        it('moves the whole selection when dragging an already-selected node', () => {
            const stage = mountSelection([rectNode('a', 0, 0), rectNode('b', 2000, 0)], ['a', 'b']);
            const from = toScreen(stage, 500, 500); // inside node a

            firePointer(stage, 'pointerdown', from.x, from.y);
            firePointer(stage, 'pointermove', from.x + 30, from.y + 20);
            firePointer(stage, 'pointerup', from.x + 30, from.y + 20);

            const doc = useStore.getState().currentDoc!;
            const a = doc.nodes.find((entry) => entry.id === 'a')!;
            const b = doc.nodes.find((entry) => entry.id === 'b')!;
            // Both moved by the same delta (10 px → the selection did not collapse).
            expect(a.transform.x).toBeGreaterThan(0);
            expect(b.transform.x).toBeGreaterThan(2000);
            expect(b.transform.x - 2000).toBe(a.transform.x);
        });

        it('collapses to the hit node on a plain click without movement', () => {
            const stage = mountSelection([rectNode('a', 0, 0), rectNode('b', 2000, 0)], ['a', 'b']);
            const from = toScreen(stage, 500, 500); // inside node a

            firePointer(stage, 'pointerdown', from.x, from.y);
            firePointer(stage, 'pointerup', from.x, from.y);

            expect(useStore.getState().selectedNodeIds).toEqual(['a']);
            const doc = useStore.getState().currentDoc!;
            const a = doc.nodes.find((entry) => entry.id === 'a')!;
            expect(a.transform.x).toBe(0);
        });

        it('does not move anything on sub-threshold jitter, and still collapses on release', () => {
            const stage = mountSelection([rectNode('a', 0, 0), rectNode('b', 2000, 0)], ['a', 'b']);
            const from = toScreen(stage, 500, 500); // inside node a

            firePointer(stage, 'pointerdown', from.x, from.y);
            // ~2.2 screen px of OS jitter: below the 3 px collapse threshold.
            firePointer(stage, 'pointermove', from.x + 2, from.y + 1);
            firePointer(stage, 'pointerup', from.x + 2, from.y + 1);

            // It was a click, so the selection collapses to the hit node ...
            expect(useStore.getState().selectedNodeIds).toEqual(['a']);
            // ... but no node moved and no undo entry was minted.
            const state = useStore.getState();
            const a = state.currentDoc!.nodes.find((entry) => entry.id === 'a')!;
            const b = state.currentDoc!.nodes.find((entry) => entry.id === 'b')!;
            expect(a.transform.x).toBe(0);
            expect(b.transform.x).toBe(2000);
            expect(state.docPast).toHaveLength(0);
        });

        it('keeps the selection when the drag is released over the MFP/rail (must-fix #5)', () => {
            const stage = mountSelection([rectNode('a', 0, 0), rectNode('b', 2000, 0)], ['a', 'b']);
            const from = toScreen(stage, 500, 500); // inside node a

            firePointer(stage, 'pointerdown', from.x, from.y);
            firePointer(stage, 'pointermove', from.x + 30, from.y + 20);
            // Released outside the stage: only the window finalizer sees it.
            act(() => {
                window.dispatchEvent(new Event('pointerup'));
            });

            expect(useStore.getState().selectedNodeIds).toEqual(['a', 'b']);
            const doc = useStore.getState().currentDoc!;
            const a = doc.nodes.find((entry) => entry.id === 'a')!;
            const b = doc.nodes.find((entry) => entry.id === 'b')!;
            expect(a.transform.x).toBeGreaterThan(0);
            expect(b.transform.x).toBeGreaterThan(2000);
            expect(b.transform.x - 2000).toBe(a.transform.x);
            expect(useStore.getState().docPast).toHaveLength(1);
        });

        it('toggles membership on a shift-click without collapsing', () => {
            const stage = mountSelection([rectNode('a', 0, 0), rectNode('b', 2000, 0)], ['a']);

            const pb = toScreen(stage, 2500, 500); // inside node b
            firePointer(stage, 'pointerdown', pb.x, pb.y, { shiftKey: true });
            expect(useStore.getState().selectedNodeIds).toEqual(['a', 'b']);

            const pa = toScreen(stage, 500, 500); // inside node a, already selected
            firePointer(stage, 'pointerdown', pa.x, pa.y, { shiftKey: true });
            expect(useStore.getState().selectedNodeIds).toEqual(['b']);
        });
    });

    describe('item 6 — text box-only live resize', () => {
        it('keeps the glyph scale at ±1 while resizing the box, and commits that box', () => {
            const stage = mountSelection([textNode('t')], ['t']);
            const transformer = stage.findOne('Transformer') as Konva.Transformer;
            const text = transformer.nodes()[0] as Konva.Text;
            expect(text, 'the Transformer must attach to the selected text node').toBeTruthy();
            const baseW = text.width();
            const baseH = text.height();

            act(() => {
                // Mimic the first live `transform`: Konva's scale is the gesture
                // factor so far. The recipe bakes it into the box and resets scale.
                text.scaleX(1.5);
                text.scaleY(1.2);
                transformer.fire('transformstart', {});
                transformer.fire('transform', {});
            });

            expect(text.scaleX()).toBe(1);
            expect(text.scaleY()).toBe(1);
            expect(text.width()).toBeCloseTo(baseW * 1.5, 5);
            expect(text.height()).toBeCloseTo(baseH * 1.2, 5);

            act(() => {
                // A second live event: the recipe reset the scale to ±1 above, so
                // `width()` is the Transformer's current box. Konva's
                // `_fitNodesInto` delta (`newTr · oldTr⁻¹`) is relative to that
                // box, so multiplying the *current* width — not the gesture base
                // — is what tracks the pointer.
                text.scaleX(2);
                text.scaleY(1.5);
                transformer.fire('transform', {});
            });

            expect(text.scaleX()).toBe(1);
            expect(text.width()).toBeCloseTo(baseW * 3, 5);
            expect(text.height()).toBeCloseTo(baseH * 1.8, 5);

            act(() => {
                transformer.fire('transformend', {});
            });

            const state = useStore.getState();
            const node = state.currentDoc!.nodes.find((entry) => entry.id === 't') as TextNode;
            // The committed box equals the live box; glyphs never scaled.
            expect(node.size).toEqual({ w: Math.round(baseW * 3), h: Math.round(baseH * 1.8) });
            expect(node.fontSize).toBe(300);
            expect(node.transform.scaleX).toBe(1);
            expect(node.transform.scaleY).toBe(1);
            expect(state.docPast).toHaveLength(1);
        });

        it('restores the committed text box when a box-only resize is cancelled', () => {
            const stage = mountSelection([textNode('t')], ['t']);
            const transformer = stage.findOne('Transformer') as Konva.Transformer;
            const text = transformer.nodes()[0] as Konva.Text;
            const baseW = text.width();
            const baseH = text.height();

            act(() => {
                transformer.fire('transformstart', {});
                // Box-only live resize: the box grows and the scale resets to ±1.
                text.scaleX(1.5);
                text.scaleY(1.5);
                transformer.fire('transform', {});
            });
            expect(text.width()).toBeCloseTo(baseW * 1.5, 5);

            act(() => {
                // No `mouseup`/`transformend`: the cancel path must revert the
                // imperatively-grown box to the committed size.
                window.dispatchEvent(new Event('pointercancel'));
            });

            expect(text.width()).toBeCloseTo(baseW, 5);
            expect(text.height()).toBeCloseTo(baseH, 5);

            const state = useStore.getState();
            expect(state.docPast).toHaveLength(0);
            const node = state.currentDoc!.nodes.find((entry) => entry.id === 't')!;
            expect(node.size).toEqual({ w: 1000, h: 500 });
        });
    });
});

/**
 * F1 regression (P4): the recenter effect must skip **only** the wheel's own
 * run. An earlier fix compared the live viewport zoom against the derived zoom,
 * which swamped every non-zoom change after a wheel zoom (rotation, backing,
 * pane resize) — the Rotate button and portrait auto-orientation stopped
 * working. The fix uses a one-shot provenance token (`wheelZoomRef`), consumed
 * by the effect on read.
 */
describe('PreviewStage P4 viewport recenter (one-shot wheel token)', () => {
    const PANE = { w: 600, h: 400 };
    const RULER_GUTTER = 24;
    // The stage measures `container.clientWidth/Height` (fixed in `beforeAll`)
    // minus the ruler gutter, which is visible by default.
    const INNER = { w: PANE.w - RULER_GUTTER, h: PANE.h - RULER_GUTTER };

    const mountDoc = (labelDoc: ReturnType<typeof createLabelDoc>) => {
        useStore.setState({
            view: 'editor',
            currentDoc: labelDoc,
            selectedNodeIds: [],
            activeTool: 'select',
            snapEnabled: false,
            rulersVisible: true,
            viewRotation: 0,
            viewRotationUserSet: false,
            zoomMode: 'fit',
            recenterToken: 0,
        });
        render(<PreviewStage />);
        const stage = Konva.stages[Konva.stages.length - 1] as Konva.Stage;
        if (!stage) throw new Error('PreviewStage did not mount a Konva stage');
        return stage;
    };

    const contentLayer = (stage: Konva.Stage): Konva.Layer => {
        const layer = stage.getLayers().at(-1);
        if (!layer) throw new Error('PreviewStage has no content layer');
        return layer;
    };

    /**
     * Fire a wheel notch (deltaMode 0). The classifier is modifier-driven, so
     * the default is ctrl+wheel — the mouse-wheel zoom (or touchpad pinch) the
     * recenter tests below exercise.
     */
    const fireWheel = (stage: Konva.Stage, x: number, y: number, deltaY: number) => {
        const evt = {
            clientX: x,
            clientY: y,
            deltaX: 0,
            deltaY,
            deltaMode: 0,
            ctrlKey: true,
            shiftKey: false,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
        };
        stage.setPointersPositions(evt as unknown as WheelEvent);
        act(() => {
            stage.fire('wheel', { evt: evt as unknown as WheelEvent, target: stage });
        });
    };

    const doc = (id: string, backingW: number, backingH: number) =>
        createLabelDoc({ id, now: 1_700_000_000, backingW, backingH });

    it('recentres on a view-rotation change after a wheel zoom', () => {
        const stage = mountDoc(doc('doc-1', 4000, 3000));
        expect(contentLayer(stage).rotation()).toBeCloseTo(0, 6);

        // A wheel zoom writes a pointer-anchored viewport and consumes the token.
        fireWheel(stage, 560, 360, -120);
        expect(useStore.getState().zoomMode).toBe('manual');

        act(() => {
            useStore.getState().toggleViewRotation();
        });

        // The token was one-shot, so the rotation change recentres: the derived
        // viewport (and therefore the layer matrix) now carries rotation 90.
        // Without the fix the zoom-equality skip swamped this change and the
        // layer stayed at rotation 0.
        expect(useStore.getState().viewRotation).toBe(90);
        expect(contentLayer(stage).rotation()).toBeCloseTo(90, 6);
    });

    it('recentres on rotation even after a wheel notch pinned at the zoom ceiling', () => {
        const stage = mountDoc(doc('doc-1', 4000, 3000));

        // Pinned at the manual ceiling: the next wheel notch computes
        // `next === ZOOM_MAX === zoom`, so the derived zoom does not change and
        // the recenter effect never runs. It must not leave a stale token that
        // swallows the following rotation (the class of bug F1a fixes).
        act(() => {
            useStore.setState({ zoomMode: 'manual', manualZoom: ZOOM_MAX });
        });
        fireWheel(stage, 300, 200, -120);
        expect(useStore.getState().manualZoom).toBe(ZOOM_MAX);

        act(() => {
            useStore.getState().toggleViewRotation();
        });

        expect(useStore.getState().viewRotation).toBe(90);
        expect(contentLayer(stage).rotation()).toBeCloseTo(90, 6);
    });

    it('recentres a second document after a wheel zoom (no off-pane pan)', () => {
        const stage = mountDoc(doc('doc-1', 4000, 3000));

        // Zoom in with the pointer off-centre so the anchored viewport is panned
        // away from the centred position it started at.
        fireWheel(stage, 560, 360, -120);
        const zoom = useStore.getState().manualZoom;
        expect(zoom).toBeGreaterThan(0);
        const wheeledX = contentLayer(stage).x();

        // Opening a second document changes the backing → the recenter effect
        // must run (the token is spent) and centre the new label.
        const next = doc('doc-2', 2000, 6000);
        act(() => {
            useStore.setState({ currentDoc: next });
        });

        const expected = centeredViewport(zoom, { backingW: next.label.backingW, backingH: next.label.backingH }, INNER, 0);
        const layer = contentLayer(stage);
        // The layer now sits at the centred position for doc-2, not the
        // wheel-anchored pan for doc-1.
        expect(layer.x()).toBeCloseTo(expected.x, 4);
        expect(layer.y()).toBeCloseTo(expected.y, 4);
        expect(layer.x()).not.toBeCloseTo(wheeledX, 1);
    });
});

/**
 * P4 wheel gestures, explicit mapping: ctrl+wheel (and a touchpad pinch, which
 * the browser reports as `ctrlKey`) zooms, shift+wheel pans horizontally, a
 * plain wheel pans vertically. The old delta-based mouse/touchpad heuristic is
 * gone, so a pan must never touch the zoom.
 *
 * The backings are deliberately wide/tall: at fit zoom the label fills the pane
 * on one axis exactly, so `clampPan` pins that axis and only the other axis can
 * move. A wide backing leaves vertical slack, a tall one horizontal slack.
 */
describe('PreviewStage P4 wheel pan gestures', () => {
    const PANE = { w: 600, h: 400 };

    const mountWheelStage = (backingW: number, backingH: number) => {
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({ id: 'doc-wheel', now: 1_700_000_000, backingW, backingH }),
            selectedNodeIds: [],
            activeTool: 'select',
            snapEnabled: false,
            rulersVisible: true,
            viewRotation: 0,
            viewRotationUserSet: false,
            zoomMode: 'fit',
            recenterToken: 0,
        });
        render(<PreviewStage />);
        const stage = Konva.stages[Konva.stages.length - 1] as Konva.Stage;
        if (!stage) throw new Error('PreviewStage did not mount a Konva stage');
        return stage;
    };

    const contentLayer = (stage: Konva.Stage): Konva.Layer => {
        const layer = stage.getLayers().at(-1);
        if (!layer) throw new Error('PreviewStage has no content layer');
        return layer;
    };

    const fireWheel = (stage: Konva.Stage, delta: { x?: number; y?: number; shiftKey?: boolean }) => {
        const evt = {
            clientX: PANE.w / 2,
            clientY: PANE.h / 2,
            deltaX: delta.x ?? 0,
            deltaY: delta.y ?? 0,
            deltaMode: 0,
            ctrlKey: false,
            shiftKey: delta.shiftKey ?? false,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
        };
        stage.setPointersPositions(evt as unknown as WheelEvent);
        act(() => {
            stage.fire('wheel', { evt: evt as unknown as WheelEvent, target: stage });
        });
    };

    it('pans vertically on a plain wheel without changing the zoom', () => {
        // Wide backing: fit fills the width, so only y has slack to pan into.
        const stage = mountWheelStage(4000, 1000);
        const layer = contentLayer(stage);
        const yBefore = layer.y();
        const zoomBefore = layer.scaleX();

        fireWheel(stage, { y: 60 });

        // The content follows the gesture (scroll down → the label moves up) ...
        expect(layer.y()).toBeCloseTo(yBefore - 60, 4);
        // ... and the fit zoom is untouched: no manual zoom was claimed.
        expect(layer.scaleX()).toBeCloseTo(zoomBefore, 6);
        expect(useStore.getState().zoomMode).toBe('fit');
    });

    it('pans horizontally on shift+wheel without changing the zoom', () => {
        // Tall backing: fit fills the height, so only x has slack to pan into.
        const stage = mountWheelStage(1000, 4000);
        const layer = contentLayer(stage);
        const xBefore = layer.x();
        const zoomBefore = layer.scaleX();

        // A mouse reports shift+wheel on deltaY, so the handler must read it there.
        fireWheel(stage, { y: 60, shiftKey: true });

        expect(layer.x()).toBeCloseTo(xBefore - 60, 4);
        expect(layer.scaleX()).toBeCloseTo(zoomBefore, 6);
        expect(useStore.getState().zoomMode).toBe('fit');
    });

    it('prefers deltaX on shift+wheel when the device already swapped the axes', () => {
        const stage = mountWheelStage(1000, 4000);
        const layer = contentLayer(stage);
        const xBefore = layer.x();

        fireWheel(stage, { x: 40, y: 90, shiftKey: true });

        // deltaX wins over the (mouse-style) deltaY of 90.
        expect(layer.x()).toBeCloseTo(xBefore - 40, 4);
    });
});

/**
 * P5 inline text editing: a double-click on a **static** text node in the
 * select tool mounts the positioned `<textarea>` overlay (from `useTextEditor`)
 * and hides that node's Konva `Text`; Esc cancels (restoring the pre-edit doc)
 * and Ctrl+Enter commits exactly one undo entry. The polygon double-click
 * finish is covered above and must be unaffected.
 */
describe('PreviewStage inline text editing (P5)', () => {
    const textNode = (id: string): TextNode => ({
        id,
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1000, h: 500 },
        text: { kind: 'static', value: 'hello world' },
        fontSize: 300,
    });

    const rectNode = (id: string): Node => ({
        id,
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1000, h: 800 },
    });

    const mountSelect = (nodes: Node[]) => {
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 4000, backingH: 3000, nodes }),
            selectedNodeIds: [],
            activeTool: 'select',
            snapEnabled: false,
        });
        render(<PreviewStage />);
        const stage = Konva.stages[Konva.stages.length - 1] as Konva.Stage;
        if (!stage) throw new Error('PreviewStage did not mount a Konva stage');
        return stage;
    };

    /** Text values of the Konva `Text` nodes currently on the content layer. */
    const renderedTextValues = (stage: Konva.Stage): string[] =>
        (stage.getLayers().at(-1)!.find('Text') as Konva.Text[]).map((node) => node.text());

    const docText = (id: string): string => {
        const node = useStore.getState().currentDoc!.nodes.find((entry) => entry.id === id);
        return node?.type === 'text' && node.text.kind === 'static' ? node.text.value : '';
    };

    /** Fire a `dblclick` at a world (hm) point, mapped to the node's screen box. */
    const dblClick = (stage: Konva.Stage, worldX: number, worldY: number) => {
        const at = toScreen(stage, worldX, worldY);
        firePointer(stage, 'dblclick', at.x, at.y, { detail: 2 });
    };

    it('mounts the overlay and hides the Konva Text on a double-click on a text node', () => {
        const stage = mountSelect([textNode('t')]);
        expect(renderedTextValues(stage)).toContain('hello world');

        dblClick(stage, 500, 250);

        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea.value).toBe('hello world');
        // While editing, the node's Konva Text must not paint under the overlay.
        expect(renderedTextValues(stage)).not.toContain('hello world');
    });

    it('does not mount the overlay on a double-click on a non-text node', () => {
        const stage = mountSelect([rectNode('r')]);
        dblClick(stage, 500, 400);
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('does not open the editor while a modal dialog is open', () => {
        const stage = mountSelect([textNode('t')]);
        const dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        document.body.appendChild(dialog);
        try {
            dblClick(stage, 500, 250);
            expect(screen.queryByRole('textbox')).toBeNull();
        } finally {
            dialog.remove();
        }
    });

    it('cancels the session on Escape (overlay unmounts, doc text restored)', () => {
        const stage = mountSelect([textNode('t')]);
        dblClick(stage, 500, 250);
        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: 'changed' } });
        expect(docText('t')).toBe('changed');

        fireEvent.keyDown(textarea, { key: 'Escape' });

        expect(screen.queryByRole('textbox')).toBeNull();
        // Esc restores the pre-edit snapshot as one undo entry.
        expect(docText('t')).toBe('hello world');
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('commits on Ctrl+Enter with one undo entry', () => {
        const stage = mountSelect([textNode('t')]);
        dblClick(stage, 500, 250);
        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: 'committed' } });

        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

        expect(screen.queryByRole('textbox')).toBeNull();
        expect(docText('t')).toBe('committed');
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('detaches the Transformer from the edited node and reattaches it on Escape', () => {
        const stage = mountSelect([textNode('t')]);
        // Select the text node so the Transformer attaches to it.
        act(() => {
            useStore.getState().selectNode('t');
        });
        const transformer = stage.findOne('Transformer') as Konva.Transformer;
        const contentLayer = stage.getLayers().at(-1)!;
        expect(transformer.nodes()).toContain(contentLayer.find('Text')[0]);

        dblClick(stage, 500, 250);
        expect(screen.getByRole('textbox')).toBeTruthy();
        // The edited node is hidden and the attach effect re-runs off the editing
        // id, so the Transformer must let go of the (now unmounted) node.
        expect(transformer.nodes()).toHaveLength(0);

        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

        expect(screen.queryByRole('textbox')).toBeNull();
        // Closing reattaches to the re-mounted text node.
        expect(transformer.nodes()).toHaveLength(1);
        expect(transformer.nodes()[0]).toBe(contentLayer.find('Text')[0]);
    });
});

/**
 * P13/S1 press-drag shape drawing: `shape:rectangle` / `shape:ellipse` /
 * `shape:line` are defined by a press-drag box (or, for a line, the two drag
 * endpoints). A sub-threshold release still inserts the default box, Escape
 * aborts the draft but keeps the tool armed, and a release outside the stage
 * commits through the window finalizer — there is no `setPointerCapture` in the
 * component, so that listener is what covers an off-canvas release.
 *
 * Every other insert (text / image / qr / barcode / code) stays click-to-place.
 */
describe('PreviewStage press-drag shape drawing (P13/S1)', () => {
    const mountDraw = (
        action: InsertAction,
        opts: { snapEnabled?: boolean; gridSpacingHm?: number } = {},
    ) => {
        useStore.setState({
            view: 'editor',
            currentDoc: makeDoc(),
            selectedNodeIds: [],
            activeTool: action,
            snapEnabled: opts.snapEnabled ?? false,
            gridSpacingHm: opts.gridSpacingHm ?? 1000,
        });
        render(<PreviewStage />);
        const stage = Konva.stages[Konva.stages.length - 1] as Konva.Stage;
        if (!stage) throw new Error('PreviewStage did not mount a Konva stage');
        return stage;
    };

    /** Rects on the content (last) layer — the live draft is one of them. */
    const contentRects = (stage: Konva.Stage): number => stage.getLayers().at(-1)!.find('Rect').length;

    const drag = (stage: Konva.Stage, from: [number, number], to: [number, number], shiftKey = false) => {
        const a = toScreen(stage, from[0], from[1]);
        const b = toScreen(stage, to[0], to[1]);
        firePointer(stage, 'pointerdown', a.x, a.y);
        firePointer(stage, 'pointermove', b.x, b.y, { shiftKey });
        firePointer(stage, 'pointerup', b.x, b.y, { shiftKey });
        return { a, b };
    };

    it('draws exactly one rectangle at the dragged geometry, with one undo entry', () => {
        const stage = mountDraw('shape:rectangle');

        drag(stage, [1200, 1000], [3000, 2000]);

        const state = useStore.getState();
        expect(state.currentDoc?.nodes).toHaveLength(1);
        expect(state.docPast).toHaveLength(1);
        const node = state.currentDoc!.nodes[0]!;
        expect(node).toMatchObject({ type: 'shape', shape: 'rectangle', transform: { x: 1200, y: 1000 } });
        expect(node.type === 'shape' && node.size).toEqual({ w: 1800, h: 1000 });
        // The tool disarms after the insert, as it did for click-to-place.
        expect(state.activeTool).toBe('select');
    });

    it('normalizes an up-left drag to the min corner (no negative box)', () => {
        const stage = mountDraw('shape:rectangle');

        drag(stage, [3000, 2000], [1200, 1000]);

        const node = useStore.getState().currentDoc!.nodes[0]!;
        expect(node).toMatchObject({ transform: { x: 1200, y: 1000 } });
        expect(node.type === 'shape' && node.size).toEqual({ w: 1800, h: 1000 });
    });

    it('draws an ellipse with box semantics', () => {
        const stage = mountDraw('shape:ellipse');

        drag(stage, [500, 500], [2500, 1500]);

        const node = useStore.getState().currentDoc!.nodes[0]!;
        expect(node).toMatchObject({ type: 'shape', shape: 'ellipse', transform: { x: 500, y: 500 } });
        expect(node.type === 'shape' && node.size).toEqual({ w: 2000, h: 1000 });
    });

    it('draws a line rebased to its bbox min', () => {
        const stage = mountDraw('shape:line');

        drag(stage, [500, 600], [2500, 2600]);

        const node = useStore.getState().currentDoc!.nodes[0]!;
        // bbox min is (500, 600): transform there, points relative to it.
        expect(node).toMatchObject({ type: 'shape', shape: 'line', transform: { x: 500, y: 600 } });
        expect(node.type === 'shape' && node.points).toEqual([[0, 0], [2000, 2000]]);
    });

    it('snaps a shifted line to 45°', () => {
        const stage = mountDraw('shape:line');

        // 2000 across, 1000 down → the 45° ray at distance hypot(2000, 1000).
        drag(stage, [500, 500], [2500, 1500], true);

        const node = useStore.getState().currentDoc!.nodes[0]!;
        const points = node.type === 'shape' ? node.points : [];
        // Snapped end (2081, 2081) rebased to the bbox min (500, 500).
        expect(node.transform).toMatchObject({ x: 500, y: 500 });
        expect(points?.[0]).toEqual([0, 0]);
        expect(points?.[1]).toEqual([1581, 1581]);
    });

    it('constrains a shifted drag to a square', () => {
        const stage = mountDraw('shape:rectangle');

        drag(stage, [1000, 1000], [3000, 2000], true);

        const node = useStore.getState().currentDoc!.nodes[0]!;
        expect(node).toMatchObject({ transform: { x: 1000, y: 1000 } });
        expect(node.type === 'shape' && node.size).toEqual({ w: 2000, h: 2000 });
    });

    it('falls back to the default box on a sub-threshold click (no dead gesture)', () => {
        const stage = mountDraw('shape:rectangle');
        const at = toScreen(stage, 1200, 1000);

        firePointer(stage, 'pointerdown', at.x, at.y);
        firePointer(stage, 'pointerup', at.x, at.y);

        const state = useStore.getState();
        expect(state.currentDoc?.nodes).toHaveLength(1);
        expect(state.docPast).toHaveLength(1);
        const node = state.currentDoc!.nodes[0]!;
        expect(node).toMatchObject({ transform: { x: 1200, y: 1000 } });
        expect(node.type === 'shape' && node.size).toEqual({ w: 1500, h: 1000 });
        expect(state.activeTool).toBe('select');
    });

    it('treats jitter below the collapse threshold as a click', () => {
        const stage = mountDraw('shape:rectangle');
        const at = toScreen(stage, 1200, 1000);

        firePointer(stage, 'pointerdown', at.x, at.y);
        firePointer(stage, 'pointermove', at.x + 2, at.y + 1);
        firePointer(stage, 'pointerup', at.x + 2, at.y + 1);

        const node = useStore.getState().currentDoc!.nodes[0]!;
        expect(node.type === 'shape' && node.size).toEqual({ w: 1500, h: 1000 });
    });

    it('aborts the draft on Escape and leaves the tool armed', () => {
        const stage = mountDraw('shape:rectangle');
        const baseline = contentRects(stage);
        const at = toScreen(stage, 1200, 1000);
        const far = toScreen(stage, 3000, 2000);

        firePointer(stage, 'pointerdown', at.x, at.y);
        firePointer(stage, 'pointermove', far.x, far.y);
        // The dashed draft is on the content layer.
        expect(contentRects(stage)).toBeGreaterThan(baseline);

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        });

        const state = useStore.getState();
        expect(state.currentDoc?.nodes).toHaveLength(0);
        expect(state.docPast).toHaveLength(0);
        // The tool stays armed so the user can redraw immediately ...
        expect(state.activeTool).toBe('shape:rectangle');
        // ... and the draft is gone.
        expect(contentRects(stage)).toBe(baseline);

        // A later release must not resurrect the aborted draft.
        firePointer(stage, 'pointerup', far.x, far.y);
        expect(useStore.getState().currentDoc?.nodes).toHaveLength(0);
    });

    it('drops the draft when the tool changes mid-drag', () => {
        const stage = mountDraw('shape:rectangle');
        const baseline = contentRects(stage);
        const at = toScreen(stage, 1200, 1000);
        const far = toScreen(stage, 3000, 2000);

        firePointer(stage, 'pointerdown', at.x, at.y);
        firePointer(stage, 'pointermove', far.x, far.y);
        expect(contentRects(stage)).toBeGreaterThan(baseline);

        act(() => {
            useStore.getState().setActiveTool('shape:ellipse');
        });

        expect(contentRects(stage)).toBe(baseline);
        // The abandoned gesture commits nothing on the eventual release.
        firePointer(stage, 'pointerup', far.x, far.y);
        expect(useStore.getState().currentDoc?.nodes).toHaveLength(0);
    });

    it('commits a drag released outside the stage via the window finalizer', () => {
        const stage = mountDraw('shape:rectangle');
        const at = toScreen(stage, 1200, 1000);
        const far = toScreen(stage, 3000, 2000);

        firePointer(stage, 'pointerdown', at.x, at.y);
        firePointer(stage, 'pointermove', far.x, far.y);
        // No setPointerCapture: a release over the MFP/rail never reaches the
        // Stage, so the window listener must commit the drawn box.
        act(() => {
            window.dispatchEvent(new Event('pointerup'));
        });

        const state = useStore.getState();
        expect(state.currentDoc?.nodes).toHaveLength(1);
        expect(state.docPast).toHaveLength(1);
        const node = state.currentDoc!.nodes[0]!;
        expect(node).toMatchObject({ transform: { x: 1200, y: 1000 } });
        expect(node.type === 'shape' && node.size).toEqual({ w: 1800, h: 1000 });
    });

    it('snaps the drawn box to the grid while dragging', () => {
        const stage = mountDraw('shape:rectangle', { snapEnabled: true, gridSpacingHm: 1000 });

        // World corners 40 hm off the 1000 hm grid lines — within the 6 px snap
        // threshold at the fit zoom — so both snap to the grid.
        drag(stage, [1960, 1960], [2960, 2960]);

        const node = useStore.getState().currentDoc!.nodes[0]!;
        expect(node).toMatchObject({ transform: { x: 2000, y: 2000 } });
        expect(node.type === 'shape' && node.size).toEqual({ w: 1000, h: 1000 });
    });

    it('keeps the tool armed after a cancel (pointercancel) without committing', () => {
        const stage = mountDraw('shape:rectangle');
        const at = toScreen(stage, 1200, 1000);
        const far = toScreen(stage, 3000, 2000);

        firePointer(stage, 'pointerdown', at.x, at.y);
        firePointer(stage, 'pointermove', far.x, far.y);

        act(() => {
            window.dispatchEvent(new Event('pointercancel'));
        });

        const state = useStore.getState();
        expect(state.currentDoc?.nodes).toHaveLength(0);
        expect(state.activeTool).toBe('shape:rectangle');
    });

    it('keeps text click-to-place on pointerdown (unchanged)', () => {
        const stage = mountDraw('text');
        const at = toScreen(stage, 800, 600);

        firePointer(stage, 'pointerdown', at.x, at.y);

        const state = useStore.getState();
        expect(state.currentDoc?.nodes).toHaveLength(1);
        const node = state.currentDoc!.nodes[0]!;
        expect(node).toMatchObject({ type: 'text', transform: { x: 800, y: 600 } });
        expect(node.type === 'text' && node.size).toEqual({ w: 2000, h: 800 });
        expect(state.activeTool).toBe('select');
    });
});

/**
 * D-37 paint order: the polygon draw preview and the press-drag insert draft must
 * paint ABOVE the committed objects, or the user cannot see what they are
 * drawing. Konva paints a Layer's children in array order, so the draft nodes
 * must sit after the `ResolvedShape` children (`listening={false}` is unrelated
 * to paint order).
 */
describe('PreviewStage draft paint order (D-37)', () => {
    const rectNode = (): Node => ({
        id: 'r',
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1000, h: 800 },
    });

    const mountDoc = (action: InsertAction) => {
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({
                id: 'doc-1',
                now: 1_700_000_000,
                backingW: 4000,
                backingH: 3000,
                nodes: [rectNode()],
            }),
            selectedNodeIds: [],
            activeTool: action,
            snapEnabled: false,
        });
        render(<PreviewStage />);
        const stage = Konva.stages[Konva.stages.length - 1] as Konva.Stage;
        if (!stage) throw new Error('PreviewStage did not mount a Konva stage');
        return stage;
    };

    const contentLayer = (stage: Konva.Stage): Konva.Layer => {
        const layer = stage.getLayers().at(-1);
        if (!layer) throw new Error('PreviewStage has no content layer');
        return layer;
    };

    /**
     * The committed rect is the only `Rect` directly on the layer (Transformer
     * anchors are children of the Transformer), and both drafts are `Line`s, so
     * the className indexes identify them unambiguously in these fixtures.
     */
    const assertDraftAboveObjects = (stage: Konva.Stage) => {
        const children = contentLayer(stage).getChildren();
        const draftIndex = children.findIndex((child) => child.getClassName() === 'Line');
        const objectIndex = children.findIndex((child) => child.getClassName() === 'Rect');
        expect(draftIndex).toBeGreaterThanOrEqual(0);
        expect(objectIndex).toBeGreaterThanOrEqual(0);
        expect(draftIndex).toBeGreaterThan(objectIndex);
        expect(children.at(-1)!.getClassName()).toBe('Transformer');
    };

    it('paints the polygon draw preview above the committed objects', () => {
        const stage = mountDoc('shape:polygon');

        firePointer(stage, 'pointerdown', 100, 100);
        firePointer(stage, 'pointerdown', 300, 120);

        assertDraftAboveObjects(stage);
    });

    it('paints the drag-draw insert draft above the committed objects', () => {
        const stage = mountDoc('shape:line');
        const at = toScreen(stage, 1200, 1000);
        const far = toScreen(stage, 3000, 2000);

        firePointer(stage, 'pointerdown', at.x, at.y);
        firePointer(stage, 'pointermove', far.x, far.y);

        assertDraftAboveObjects(stage);
    });
});

/**
 * The pure pick rule behind the pointer-down hit test lives in
 * `editor/selectionModel.ts` and is unit-tested in its own test file; these are
 * the mounted-stage consequences of it.
 *
 * Round-2 backlog: overlapping-object select priority. A selection made from
 * the layer list (or by marquee) owns its own box: a press inside that box
 * targets the selected node even when another node is stacked above it — which
 * is also what makes the *selected* node the one a drag moves. Outside the
 * selected box the plain topmost hit stands, and an additive press stays a
 * membership toggle on the topmost node.
 */
describe('PreviewStage overlapping-object select priority (round-2 backlog)', () => {
    const rectNode = (id: string, x: number, y: number): Node => ({
        id,
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 1000, h: 1000 },
    });

    // Paint order (front last): `upper` is drawn on top of `lower`, so it is the
    // node today's plain `hitTestWorld` picks inside the overlap [1500,2000]².
    const OVERLAP: [number, number] = [1750, 1750];
    const UPPER_ONLY: [number, number] = [2300, 2300];

    const mountOverlap = (selected: string[]) => {
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({
                id: 'doc-1',
                now: 1_700_000_000,
                backingW: 4000,
                backingH: 3000,
                nodes: [rectNode('lower', 1000, 1000), rectNode('upper', 1500, 1500), rectNode('other', 3000, 0)],
            }),
            selectedNodeIds: selected,
            activeTool: 'select',
            snapEnabled: false,
        });
        render(<PreviewStage />);
        const stage = Konva.stages[Konva.stages.length - 1] as Konva.Stage;
        if (!stage) throw new Error('PreviewStage did not mount a Konva stage');
        return stage;
    };

    const at = (id: string) => {
        const node = useStore.getState().currentDoc!.nodes.find((entry) => entry.id === id)!;
        return node.transform;
    };

    it('keeps the selected lower node on a press inside the overlap', () => {
        const stage = mountOverlap(['lower']);
        const p = toScreen(stage, ...OVERLAP);

        firePointer(stage, 'pointerdown', p.x, p.y);

        // Without the priority rule the hit test returns `upper` (the topmost
        // node) and this selection would be rewritten to ['upper'].
        expect(useStore.getState().selectedNodeIds).toEqual(['lower']);
    });

    it('selects the topmost node when the press misses the selected node box', () => {
        const stage = mountOverlap(['lower']);
        const p = toScreen(stage, ...UPPER_ONLY);

        firePointer(stage, 'pointerdown', p.x, p.y);

        expect(useStore.getState().selectedNodeIds).toEqual(['upper']);
    });

    it('keeps a multi-selection on the press and collapses to the priority node on release', () => {
        const stage = mountOverlap(['lower', 'other']);
        const p = toScreen(stage, ...OVERLAP);

        firePointer(stage, 'pointerdown', p.x, p.y);
        // The whole selection is preserved so a drag would move all of it ...
        expect(useStore.getState().selectedNodeIds).toEqual(['lower', 'other']);

        // ... and a no-move release is a click, so it focuses the node the press
        // actually hit (`lower`, not the `upper` node stacked above it).
        firePointer(stage, 'pointerup', p.x, p.y);
        expect(useStore.getState().selectedNodeIds).toEqual(['lower']);
    });

    it('drags the selected lower node, leaving the node stacked above it alone', () => {
        const stage = mountOverlap(['lower']);
        const p = toScreen(stage, ...OVERLAP);

        firePointer(stage, 'pointerdown', p.x, p.y);
        firePointer(stage, 'pointermove', p.x + 40, p.y + 30);
        firePointer(stage, 'pointerup', p.x + 40, p.y + 30);

        // Without the priority rule the press retargets the drag to `upper`, so
        // the lower node would never move off its origin.
        expect(at('lower').x).toBeGreaterThan(1000);
        expect(at('lower').y).toBeGreaterThan(1000);
        expect(at('upper')).toMatchObject({ x: 1500, y: 1500 });
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('still toggles the topmost node on an additive press inside the overlap', () => {
        const stage = mountOverlap(['lower']);
        const p = toScreen(stage, ...OVERLAP);

        // Additive presses are membership toggles, not drags: they keep the
        // plain topmost hit so a node above the selection stays reachable.
        firePointer(stage, 'pointerdown', p.x, p.y, { shiftKey: true });

        expect(useStore.getState().selectedNodeIds).toEqual(['lower', 'upper']);
    });
});

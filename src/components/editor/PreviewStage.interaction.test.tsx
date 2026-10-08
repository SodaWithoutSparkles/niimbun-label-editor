// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import Konva from 'konva';
import '../../i18n';
import { installCanvasShim } from '../../test/canvasHarness';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node } from '../../core/doc/types';
import { PreviewStage } from './PreviewStage';

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
}

/** Fire one pointer event at pane position (x, y) on the mounted stage. */
const firePointer = (stage: Konva.Stage, type: string, x: number, y: number, opts: FireOptions = {}) => {
    const evt = {
        clientX: x,
        clientY: y,
        button: opts.button ?? 0,
        detail: opts.detail ?? 1,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
    };
    stage.setPointersPositions(evt as unknown as PointerEvent);
    act(() => {
        stage.fire(type, { evt: evt as unknown as PointerEvent, target: stage });
    });
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
});

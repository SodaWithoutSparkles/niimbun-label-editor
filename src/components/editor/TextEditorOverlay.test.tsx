// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc, Node } from '../../core/doc/types';
import {
    TextEditorOverlay,
    computeScreenPlacement,
    useTextEditor,
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

/** The hook takes no geometry argument; nothing to stub. */

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
        // Konva absolute matrix [a,b,c,d,e,f]; here e/f are the screen origin.
        // The box is rendered by CSS scale, so placement returns only origin+rotation.
        expect(computeScreenPlacement([1, 0, 0, 1, 30, 40])).toEqual({
            screenX: 30,
            screenY: 40,
            rotation: 0,
        });
    });

    it('reads a rotate-90 matrix as 90°', () => {
        // 90° rotation with uniform scale z=2: [a,b,c,d,e,f] = [0,z,-z,0,e,f].
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

    it('applies the session box, unscaled font and per-axis scale without re-scaling', () => {
        render(overlay({ wrap: 'clip' }));
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

        // fontSize is the node's value in px, never multiplied by scale; the
        // CSS transform carries the per-axis scale exactly like Konva.
        expect(textarea.style.fontSize).toBe('300px');
        expect(textarea.style.padding).toBe('0px');
        expect(textarea.style.left).toBe('10px');
        expect(textarea.style.top).toBe('20px');
        expect(textarea.style.width).toBe('200px');
        expect(textarea.style.height).toBe('100px');
        // The box stays the *unscaled* hm extent; CSS `scale` renders the screen
        // size once (never twice).
        expect(textarea.style.transform).toBe('rotate(0deg) scale(2, 3)');
    });

    it('rotates the overlay by the session rotation, keeping the scale', () => {
        render(overlay({ session: { ...session, rotation: 90 } }));
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
        expect(textarea.style.transform).toBe('rotate(90deg) scale(2, 3)');
    });
});

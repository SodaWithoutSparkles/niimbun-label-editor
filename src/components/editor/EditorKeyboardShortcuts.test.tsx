// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node } from '../../core/doc/types';
import { EditorKeyboardShortcuts } from './EditorKeyboardShortcuts';

const node = (id: string, over: Record<string, unknown> = {}): Node =>
    ({
        id,
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 100, h: 100 },
        ...over,
    }) as unknown as Node;

const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    window.dispatchEvent(event);
    return event;
};

const release = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...init });
    window.dispatchEvent(event);
    return event;
};

beforeEach(() => {
    useStore.setState({
        view: 'editor',
        isSettingsOpen: false,
        isPrintOpen: false,
        selectedNodeIds: [],
        activeTool: 'select',
    });
});

afterEach(() => {
    cleanup();
    useStore.setState({
        currentDoc: null,
        selectedNodeIds: [],
        isSettingsOpen: false,
        isPrintOpen: false,
        view: 'gallery',
    });
});

describe('EditorKeyboardShortcuts', () => {
    it('Ctrl+A selects only top-level, effectively visible and unlocked nodes (must-fix #16)', () => {
        const children = [
            node('root-visible'),
            node('root-hidden', { visible: false }),
            node('root-locked', { locked: true }),
            node('root-parent'),
            node('child-visible', { parentId: 'root-parent' }),
        ];
        useStore.setState({
            currentDoc: createLabelDoc({ id: 'doc-1', now: 1_700_000_000, nodes: children }),
        });
        render(<EditorKeyboardShortcuts />);

        press('a', { ctrlKey: true });

        expect(useStore.getState().selectedNodeIds).toEqual(['root-visible', 'root-parent']);
    });

    it('bails while a modal dialog is open', () => {
        const dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        document.body.appendChild(dialog);
        useStore.setState({ currentDoc: createLabelDoc({ id: 'doc-1', now: 1, nodes: [node('a')] }) });
        render(<EditorKeyboardShortcuts />);

        press('a', { ctrlKey: true });

        expect(useStore.getState().selectedNodeIds).toEqual([]);
        dialog.remove();
    });
});

describe('EditorKeyboardShortcuts — duplicate selects the clones (H2)', () => {
    it('Ctrl+D clones the selection, selects the clones and deselects the sources', () => {
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({ id: 'doc-1', now: 1, nodes: [node('a'), node('b')] }),
            selectedNodeIds: ['a', 'b'],
        });
        render(<EditorKeyboardShortcuts />);

        press('d', { ctrlKey: true });

        const state = useStore.getState();
        const selected = state.selectedNodeIds;
        const docIds = state.currentDoc!.nodes.map((n) => n.id);
        // Two clones keyed by fresh ids; the sources are deselected.
        expect(selected).toHaveLength(2);
        expect(selected).not.toContain('a');
        expect(selected).not.toContain('b');
        for (const id of selected) expect(docIds).toContain(id);
        // The clone commits landed (the doc gained exactly the two clones).
        expect(state.currentDoc!.nodes).toHaveLength(4);
    });

    it('Cmd+D (metaKey) selects the clones too', () => {
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({ id: 'doc-1', now: 1, nodes: [node('a')] }),
            selectedNodeIds: ['a'],
        });
        render(<EditorKeyboardShortcuts />);

        press('d', { metaKey: true });

        const state = useStore.getState();
        expect(state.selectedNodeIds).toHaveLength(1);
        expect(state.selectedNodeIds).not.toContain('a');
    });
});

describe('EditorKeyboardShortcuts — print (Ctrl/Cmd+P)', () => {
    const withDoc = () =>
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({ id: 'doc-1', now: 1, nodes: [node('a')] }),
        });

    it('Ctrl+P opens the print dialog and suppresses the browser print dialog', () => {
        withDoc();
        render(<EditorKeyboardShortcuts />);

        const event = press('p', { ctrlKey: true });

        expect(event.defaultPrevented).toBe(true);
        expect(useStore.getState().isPrintOpen).toBe(true);
    });

    it('Cmd+P (metaKey) opens the print dialog too', () => {
        withDoc();
        render(<EditorKeyboardShortcuts />);

        press('p', { metaKey: true });

        expect(useStore.getState().isPrintOpen).toBe(true);
    });

    it('is ignored while a modal dialog is open', () => {
        const dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        document.body.appendChild(dialog);
        withDoc();
        render(<EditorKeyboardShortcuts />);

        const event = press('p', { ctrlKey: true });

        expect(event.defaultPrevented).toBe(false);
        expect(useStore.getState().isPrintOpen).toBe(false);
        dialog.remove();
    });

    it('does nothing in the gallery', () => {
        useStore.setState({
            view: 'gallery',
            currentDoc: createLabelDoc({ id: 'doc-1', now: 1, nodes: [node('a')] }),
        });
        render(<EditorKeyboardShortcuts />);

        press('p', { ctrlKey: true });

        expect(useStore.getState().isPrintOpen).toBe(false);
    });
});

describe('EditorKeyboardShortcuts — arrow nudge (P4 W4)', () => {
    const withSelectedNode = () =>
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({ id: 'doc-1', now: 1, nodes: [node('a')] }),
            selectedNodeIds: ['a'],
        });

    const x = () => useStore.getState().currentDoc!.nodes[0]!.transform.x;
    const y = () => useStore.getState().currentDoc!.nodes[0]!.transform.y;

    it('nudges 0.1 mm, escalates to 1 mm then 2 mm on repeats, and resets on keyup', () => {
        withSelectedNode();
        render(<EditorKeyboardShortcuts />);

        press('ArrowRight');
        expect(x()).toBe(10);
        press('ArrowRight');
        expect(x()).toBe(110);
        press('ArrowRight');
        expect(x()).toBe(310);

        release('ArrowRight');
        press('ArrowRight');
        expect(x()).toBe(320);
    });

    it('nudges in the direction of each arrow', () => {
        withSelectedNode();
        render(<EditorKeyboardShortcuts />);

        press('ArrowUp');
        expect(y()).toBe(-10);
        press('ArrowDown');
        expect(y()).toBe(0);
        press('ArrowLeft');
        expect(x()).toBe(-10);
        press('ArrowRight');
        expect(x()).toBe(0);
    });

    it('does not nudge while a modal dialog is open', () => {
        const dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        document.body.appendChild(dialog);
        withSelectedNode();
        render(<EditorKeyboardShortcuts />);

        press('ArrowRight');

        expect(x()).toBe(0);
        dialog.remove();
    });

    it('is a no-op with an empty selection', () => {
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({ id: 'doc-1', now: 1, nodes: [node('a')] }),
            selectedNodeIds: [],
        });
        render(<EditorKeyboardShortcuts />);
        const before = useStore.getState().docPast.length;

        press('ArrowRight');

        expect(x()).toBe(0);
        expect(useStore.getState().docPast).toHaveLength(before);
    });

    it('ignores arrows combined with a modifier', () => {
        withSelectedNode();
        render(<EditorKeyboardShortcuts />);

        press('ArrowRight', { shiftKey: true });
        press('ArrowRight', { altKey: true });
        press('ArrowRight', { ctrlKey: true });

        expect(x()).toBe(0);
    });

    it('records exactly one undo entry per press', () => {
        withSelectedNode();
        render(<EditorKeyboardShortcuts />);
        const before = useStore.getState().docPast.length;

        press('ArrowRight');
        expect(useStore.getState().docPast).toHaveLength(before + 1);
        // A discrete press releases the key between presses; two keydowns with
        // no keyup are a single hold and now coalesce (see the coalesce test).
        release('ArrowRight');
        press('ArrowRight');
        expect(useStore.getState().docPast).toHaveLength(before + 2);
    });

    it('coalesces a held key (OS auto-repeat) into a single undo entry', () => {
        withSelectedNode();
        render(<EditorKeyboardShortcuts />);
        const before = useStore.getState().docPast.length;

        press('ArrowRight'); // 0.1 mm — opens the undo entry
        press('ArrowRight', { repeat: true }); // 1 mm
        press('ArrowRight', { repeat: true }); // 2 mm
        press('ArrowRight', { repeat: true }); // 2 mm

        expect(x()).toBe(10 + 100 + 200 + 200);
        expect(useStore.getState().docPast).toHaveLength(before + 1);
    });

    it('pushes a baseline for a repeat that lands after a mid-hold selection (regression)', () => {
        // Regression: `event.repeat` is not proof a baseline was pushed. A
        // keydown can bail (empty selection / armed tool) before the escalation
        // ref advances; a repeat arriving after a selection appears mid-hold must
        // still push a baseline or the whole hold is unrecoverable by undo.
        useStore.setState({
            view: 'editor',
            currentDoc: createLabelDoc({ id: 'doc-1', now: 1, nodes: [node('a')] }),
            selectedNodeIds: [],
        });
        render(<EditorKeyboardShortcuts />);
        const before = useStore.getState().docPast.length;

        // Held with nothing selected: the ref never advances, so no baseline exists.
        press('ArrowRight');
        press('ArrowRight', { repeat: true });

        // The selection appears mid-hold while the key is still down.
        useStore.setState({ selectedNodeIds: ['a'] });
        press('ArrowRight', { repeat: true }); // first effective nudge — pushes a baseline
        press('ArrowRight', { repeat: true }); // later repeat — coalesces into it
        release('ArrowRight');

        expect(x()).toBe(10 + 100);
        expect(useStore.getState().docPast).toHaveLength(before + 1);
    });

    it('resets the escalation when the window loses focus', () => {
        withSelectedNode();
        render(<EditorKeyboardShortcuts />);

        press('ArrowRight');
        expect(x()).toBe(10);
        press('ArrowRight', { repeat: true });
        expect(x()).toBe(110);

        // A missed keyup (alt-tab / devtools) is recovered by the blur reset.
        window.dispatchEvent(new Event('blur'));

        press('ArrowRight');
        expect(x()).toBe(120);
    });

    it('does not nudge the selection while an insert tool is armed', () => {
        withSelectedNode();
        useStore.setState({ activeTool: 'text' });
        render(<EditorKeyboardShortcuts />);
        const before = useStore.getState().docPast.length;

        press('ArrowRight');

        expect(x()).toBe(0);
        expect(useStore.getState().docPast).toHaveLength(before);
    });

    it('nudges the selection while the pan tool is armed (pan is view-only)', () => {
        withSelectedNode();
        useStore.setState({ activeTool: 'pan' });
        render(<EditorKeyboardShortcuts />);
        const before = useStore.getState().docPast.length;

        press('ArrowRight');

        // Without treating `pan` as view-only the guard `!== 'select'` would
        // swallow the nudge (x stays 0 and no undo entry is pushed).
        expect(x()).toBe(10);
        expect(useStore.getState().docPast).toHaveLength(before + 1);
    });
});

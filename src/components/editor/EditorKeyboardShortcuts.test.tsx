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

beforeEach(() => {
    useStore.setState({ view: 'editor', isSettingsOpen: false, isPrintOpen: false, selectedNodeIds: [] });
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

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

const press = (key: string, init: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

describe('EditorKeyboardShortcuts', () => {
    beforeEach(() => {
        useStore.setState({ view: 'editor', isSettingsOpen: false, selectedNodeIds: [] });
    });
    afterEach(() => {
        cleanup();
        useStore.setState({ currentDoc: null, selectedNodeIds: [], isSettingsOpen: false, view: 'gallery' });
    });

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

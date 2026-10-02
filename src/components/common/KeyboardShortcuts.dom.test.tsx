import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { useStore } from '../../store/useStore';
import type { CanvasItem } from '../../types';

/**
 * Konva needs a real canvas, which the DOM test environment does not provide.
 * The paste handler under test registers independently of Konva, so stub the
 * Konva primitives with plain elements to mount `DrawingCanvas` in the DOM.
 */
vi.mock('react-konva', () => {
    const Pass = ({ children }: { children?: React.ReactNode }) =>
        React.createElement('div', null, children);
    return {
        Stage: Pass,
        Layer: Pass,
        Rect: Pass,
        Circle: Pass,
        Line: Pass,
        Star: Pass,
        Arrow: Pass,
        Text: Pass,
        Image: Pass,
        Transformer: Pass,
        Group: Pass,
    };
});

// The app initialises i18next in `main.tsx`; mount the same setup here because
// `DrawingCanvas` calls `useTranslation`.
import '../../i18n';
import { DrawingCanvas } from '../canvas/DrawingCanvas';

/** A rectangular shape with the fields `deleteSelected` touches. */
const makeShape = (id: string): CanvasItem => ({
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    stroke: '#000000',
    strokeWidth: 1,
    fill: '#ffffff',
    opacity: 1,
    draggable: true,
    width: 10,
    height: 10,
});

const press = (init: KeyboardEventInit) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
};

describe('KeyboardShortcuts dialog guards', () => {
    let dialog: HTMLDialogElement;

    beforeEach(() => {
        // Seed a deletable selection and a known settings state.
        useStore.setState({
            objects: [makeShape('shape-1')],
            selectedIds: ['shape-1'],
            isSettingsOpen: false,
        });
        render(<KeyboardShortcuts />);
    });

    afterEach(() => {
        cleanup();
        dialog?.remove();
        useStore.setState({ isSettingsOpen: false });
    });

    it('handles Delete and Ctrl+, when no dialog is open', () => {
        press({ key: 'Delete' });
        expect(useStore.getState().objects).toHaveLength(0);

        press({ key: ',', ctrlKey: true });
        expect(useStore.getState().isSettingsOpen).toBe(true);
    });

    it('ignores Delete and Ctrl+, while a dialog[open] is present', () => {
        dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        document.body.appendChild(dialog);

        press({ key: 'Delete' });
        expect(useStore.getState().objects).toHaveLength(1);

        press({ key: ',', ctrlKey: true });
        expect(useStore.getState().isSettingsOpen).toBe(false);
    });
});

describe('DrawingCanvas paste dialog guard', () => {
    let dialog: HTMLDialogElement;

    const dispatchPaste = () => {
        const clipboardData = new DataTransfer();
        clipboardData.setData('text/plain', 'data:image/png;base64,iVBORw0KGgo=');
        const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData,
        });
        window.dispatchEvent(event);
        return event;
    };

    beforeEach(() => {
        useStore.setState({ objects: [], selectedIds: [] });
        render(<DrawingCanvas />);
    });

    afterEach(() => {
        cleanup();
        dialog?.remove();
    });

    it('ignores paste while a dialog[open] is present', () => {
        dialog = document.createElement('dialog');
        dialog.setAttribute('open', '');
        document.body.appendChild(dialog);

        const event = dispatchPaste();

        // The handler bails before `preventDefault`, so the paste is left to the
        // dialog (e.g. a filename input) instead of mutating the canvas behind it.
        expect(event.defaultPrevented).toBe(false);
    });

    it('handles paste when no dialog is open', () => {
        const event = dispatchPaste();

        // The handler recognised the clipboard image URL and consumed the paste.
        expect(event.defaultPrevented).toBe(true);
    });
});

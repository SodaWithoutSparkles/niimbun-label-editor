import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { SampleRowContext } from './sampleRowContext';
import type { SampleRowState } from './useSampleRow';
import { EditorStatusBar } from './EditorStatusBar';

/**
 * EditorStatusBar (ui-spec.md §9): the sample-row popup. The row is 1-based and
 * clamped to the attached table, and a typed row commits once (on blur/Enter),
 * not per keystroke.
 */

const makeDoc = (sampleRowIndex = 0) => {
    const doc = createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes: [] });
    doc.data.csv = { csvId: 'csv-1', name: 'products.csv', source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' } };
    doc.data.sampleRowIndex = sampleRowIndex;
    return doc;
};

const state = (rowCount: number): SampleRowState => ({
    overrides: new Map(),
    trust: 'ask',
    blocked: false,
    needsApproval: false,
    globalWarnings: [],
    templateErrors: new Map(),
    rowCount,
    error: null,
});

const renderBar = (rowCount: number, sampleRowIndex = 0) => {
    const doc = makeDoc(sampleRowIndex);
    useStore.setState({ currentDoc: doc });
    return render(
        <SampleRowContext.Provider value={state(rowCount)}>
            <EditorStatusBar />
        </SampleRowContext.Provider>,
    );
};

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, docPast: [], docFuture: [] });
});

describe('EditorStatusBar — sample-row navigation (BLOCKER)', () => {
    it('labels the trigger and the input 1-based', () => {
        renderBar(3, 0);
        expect(screen.getByText('Row 1 / 3')).toBeTruthy();

        fireEvent.click(screen.getByTitle('Sample row'));
        expect((screen.getByLabelText('Row (1-based)') as HTMLInputElement).value).toBe('1');
    });

    it('exposes popup a11y state on the trigger', () => {
        renderBar(3, 0);
        const trigger = screen.getByTitle('Sample row');
        expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('commits a typed row on Enter as one undo entry, not per keystroke', () => {
        renderBar(3, 0);
        fireEvent.click(screen.getByTitle('Sample row'));
        const input = screen.getByLabelText('Row (1-based)') as HTMLInputElement;

        fireEvent.change(input, { target: { value: '3' } });
        // Typing alone must not commit.
        expect(useStore.getState().docPast).toHaveLength(0);

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(useStore.getState().currentDoc!.data.sampleRowIndex).toBe(2);
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('clamps a typed row past the end of the table', () => {
        renderBar(3, 0);
        fireEvent.click(screen.getByTitle('Sample row'));
        const input = screen.getByLabelText('Row (1-based)') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '99' } });
        fireEvent.blur(input);
        expect(useStore.getState().currentDoc!.data.sampleRowIndex).toBe(2);
    });

    it('disables prev at the first row and next at the last', () => {
        renderBar(3, 0);
        fireEvent.click(screen.getByTitle('Sample row'));
        expect((screen.getByText('Previous row') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByText('Next row') as HTMLButtonElement).disabled).toBe(false);
    });

    it('clamps next at the last row', () => {
        renderBar(3, 2);
        fireEvent.click(screen.getByTitle('Sample row'));
        expect((screen.getByText('Next row') as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByText('Previous row'));
        expect(useStore.getState().currentDoc!.data.sampleRowIndex).toBe(1);
    });
});

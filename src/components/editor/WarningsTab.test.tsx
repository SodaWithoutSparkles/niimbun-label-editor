// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc } from '../../core/doc/types';
import type { EditorWarning, EditorWarningGroup } from '../../editor/warnings';
import { WarningsTab } from './WarningsTab';

/**
 * WarningsTab (P6): the warning center's 5th MFP tab. Renders the empty state,
 * node-scoped entries as jumpable buttons, and document-level entries as plain
 * non-clickable rows.
 */

const makeDoc = (id = 'doc-1'): LabelDoc =>
    createLabelDoc({ id, now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes: [] });

const preview = (docId: string, warnings: EditorWarning[]): EditorWarningGroup => ({ docId, warnings });

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, selectedNodeIds: [], resourceRepo: null, editorWarnings: {} });
});

describe('WarningsTab', () => {
    it('renders the empty state when there are no warnings', async () => {
        const doc = makeDoc();
        useStore.setState({ currentDoc: doc, editorWarnings: {} });

        render(<WarningsTab />);

        expect(await screen.findByText('No warnings for this document.')).toBeInTheDocument();
    });

    it('renders a per-kind asset warning with the asset label', async () => {
        const doc = makeDoc();
        useStore.setState({
            currentDoc: doc,
            editorWarnings: {
                preview: preview(doc.meta.id, [
                    { id: 'asset:n1', kind: 'asset', nodeId: 'n1', assetWarning: 'missing', label: 'Logo' },
                ]),
            },
        });

        render(<WarningsTab />);

        expect(await screen.findByTestId('warning-asset:n1')).toHaveTextContent('Image asset unavailable: Logo.');
    });

    it('jumps to the node when a node-scoped entry is clicked', async () => {
        const doc = makeDoc();
        useStore.setState({
            currentDoc: doc,
            editorWarnings: {
                preview: preview(doc.meta.id, [
                    { id: 'keep-out:n1', kind: 'keep-out', nodeId: 'n1', label: 'Label 1' },
                ]),
            },
        });

        render(<WarningsTab />);

        const button = await screen.findByTestId('warning-keep-out:n1');
        expect(button.tagName).toBe('BUTTON');
        fireEvent.click(button);

        expect(useStore.getState().selectedNodeIds).toEqual(['n1']);
    });

    it('renders a document-level entry as non-clickable text', async () => {
        const doc = makeDoc();
        useStore.setState({
            currentDoc: doc,
            editorWarnings: {
                print: preview(doc.meta.id, [
                    { id: 'print:overflow', kind: 'print-overflow', width: 591, head: 567 },
                ]),
            },
        });

        render(<WarningsTab />);

        const row = await screen.findByTestId('warning-print:overflow');
        expect(row.tagName).toBe('P');
        expect(row).toHaveTextContent('591 px wide vs 567 px');
    });

    it('ignores a group scoped to another document', async () => {
        const doc = makeDoc('doc-1');
        useStore.setState({
            currentDoc: doc,
            editorWarnings: {
                preview: preview('doc-2', [
                    { id: 'asset:n1', kind: 'asset', nodeId: 'n1', assetWarning: 'missing', label: 'Logo' },
                ]),
            },
        });

        render(<WarningsTab />);

        expect(await screen.findByText('No warnings for this document.')).toBeInTheDocument();
        expect(screen.queryByTestId('warning-asset:n1')).toBeNull();
    });

    it('renders the empty state when no document is open even with groups present', async () => {
        useStore.setState({
            currentDoc: null,
            editorWarnings: {
                preview: preview('doc-1', [
                    { id: 'asset:n1', kind: 'asset', nodeId: 'n1', assetWarning: 'missing', label: 'Logo' },
                ]),
            },
        });

        render(<WarningsTab />);

        expect(await screen.findByText('No warnings for this document.')).toBeInTheDocument();
        expect(screen.queryByTestId('warning-asset:n1')).toBeNull();
    });

    it('ignores a csv group whose scope is a different table', async () => {
        const doc = makeDoc();
        doc.data.csv = { csvId: 'csv-1', name: 'x.csv', source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' } };
        useStore.setState({
            currentDoc: doc,
            editorWarnings: {
                csv: { docId: doc.meta.id, scopeId: 'csv-2', warnings: [{ id: 'csv:empty:0', kind: 'csv-empty' }] },
            },
        });

        render(<WarningsTab />);

        expect(await screen.findByText('No warnings for this document.')).toBeInTheDocument();
        expect(screen.queryByTestId('warning-csv:empty:0')).toBeNull();
    });

    it('shows a csv group scoped to the attached table', async () => {
        const doc = makeDoc();
        doc.data.csv = { csvId: 'csv-1', name: 'x.csv', source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' } };
        useStore.setState({
            currentDoc: doc,
            editorWarnings: {
                csv: { docId: doc.meta.id, scopeId: 'csv-1', warnings: [{ id: 'csv:empty:0', kind: 'csv-empty' }] },
            },
        });

        render(<WarningsTab />);

        expect(await screen.findByTestId('warning-csv:empty:0')).toHaveTextContent('The file has no rows.');
    });

    it('renders a template error as a jump button and a template block as plain text', async () => {
        const doc = makeDoc();
        useStore.setState({
            currentDoc: doc,
            editorWarnings: {
                preview: preview(doc.meta.id, [
                    { id: 'template:n1', kind: 'template-error', nodeId: 'n1', label: 'Title', message: 'boom' },
                    { id: 'template:blocked', kind: 'template-blocked' },
                ]),
            },
        });

        render(<WarningsTab />);

        const errorRow = await screen.findByTestId('warning-template:n1');
        expect(errorRow.tagName).toBe('BUTTON');
        fireEvent.click(errorRow);
        expect(useStore.getState().selectedNodeIds).toEqual(['n1']);

        expect(screen.getByTestId('warning-template:blocked').tagName).toBe('P');
    });

    it('reads all three asset kinds from the literal key map', async () => {
        const doc = makeDoc();
        useStore.setState({
            currentDoc: doc,
            editorWarnings: {
                preview: preview(doc.meta.id, [
                    { id: 'asset:a', kind: 'asset', nodeId: 'a', assetWarning: 'invalid', label: 'QR' },
                    { id: 'asset:b', kind: 'asset', nodeId: 'b', assetWarning: 'too-small', label: 'Barcode' },
                ]),
            },
        });

        render(<WarningsTab />);

        expect(await screen.findByTestId('warning-asset:a')).toHaveTextContent('Symbol data is invalid: QR.');
        expect(screen.getByTestId('warning-asset:b')).toHaveTextContent('Symbol modules may be too small to scan: Barcode.');
    });

    it('re-renders when a producer publishes a new group', async () => {
        const doc = makeDoc();
        useStore.setState({ currentDoc: doc, editorWarnings: {} });

        render(<WarningsTab />);
        expect(await screen.findByText('No warnings for this document.')).toBeInTheDocument();

        act(() => {
            useStore.setState({
                editorWarnings: {
                    preview: preview(doc.meta.id, [
                        { id: 'asset:n1', kind: 'asset', nodeId: 'n1', assetWarning: 'missing', label: 'Logo' },
                    ]),
                },
            });
        });

        expect(await screen.findByTestId('warning-asset:n1')).toHaveTextContent('Image asset unavailable: Logo.');
    });
});

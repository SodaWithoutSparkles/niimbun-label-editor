// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { ContentSource, Node } from '../../core/doc/types';
import { SampleRowContext } from './sampleRowContext';
import type { SampleRowState } from './useSampleRow';
import { JsTab } from './JsTab';

/**
 * JsTab source authoring (P6 W6): the kind switcher is the only place a source
 * is rewritten; editing a csv/template field must preserve its kind.
 */

const textNode = (text: ContentSource): Node => ({
    id: 't1',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text,
});

const doc = (nodes: Node[]) => createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, selectedNodeIds: [], docPast: [], csvRepo: null });
});

const kindSelect = (): HTMLSelectElement =>
    screen.getAllByRole('combobox').find((el) =>
        Array.from((el as HTMLSelectElement).options).some((option) => option.value === 'template'),
    ) as HTMLSelectElement;

describe('JsTab — content source kind switcher', () => {
    it('shows the static editor for a static node', () => {
        const selected = textNode({ kind: 'static', value: 'hi' });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t1'] });
        render(<JsTab selected={[selected]} />);

        expect(kindSelect().value).toBe('static');
        expect((screen.getByLabelText('Text') as HTMLInputElement).value).toBe('hi');
    });

    it('shows the csv editor (column + fallback) for a csv node without rewriting it', () => {
        const source = { kind: 'csv' as const, column: 'name', fallback: 'FB' };
        const selected = textNode(source);
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t1'] });
        render(<JsTab selected={[selected]} />);

        expect(kindSelect().value).toBe('csv');
        // Editing the fallback keeps the csv kind (no silent rewrite to static).
        fireEvent.change(screen.getByLabelText('Fallback'), { target: { value: 'FB2' } });

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't1')! as { text: unknown };
        expect(persisted.text).toEqual({ kind: 'csv', column: 'name', fallback: 'FB2' });
    });

    it('shows the template editor and trust state for a template node', () => {
        const selected = textNode({ kind: 'template', code: 'return 1', fallback: 'FB' });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t1'] });
        render(<JsTab selected={[selected]} />);

        expect(kindSelect().value).toBe('template');
        expect(screen.getByText('Ask each time')).toBeTruthy();
        expect((screen.getByLabelText('Template code') as HTMLTextAreaElement).value).toBe('return 1');
    });

    it('only rewrites to static when the kind switcher is used explicitly', () => {
        const selected = textNode({ kind: 'csv', column: 'name', fallback: 'FB' });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t1'] });
        render(<JsTab selected={[selected]} />);

        fireEvent.change(kindSelect(), { target: { value: 'static' } });

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't1')! as { text: unknown };
        expect(persisted.text).toEqual({ kind: 'static', value: '' });
    });

    it('is disabled-with-reason when the selection cannot carry a source', () => {
        const image: Node = {
            id: 'i1',
            parentId: null,
            type: 'image',
            imageId: '',
            visible: true,
            locked: false,
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        };
        useStore.setState({ currentDoc: doc([image]), selectedNodeIds: ['i1'] });
        render(<JsTab selected={[image]} />);

        expect(screen.getByText(/Select a text, QR or barcode/)).toBeTruthy();
    });
});

const trustState = (trust: 'ask' | 'always' | 'never'): SampleRowState => ({
    overrides: new Map(),
    trust,
    blocked: trust === 'never',
    needsApproval: trust === 'ask',
    globalWarnings: [],
    templateErrors: new Map(),
    rowCount: 0,
    error: null,
});

const renderWithTrust = (node: Node, trust: 'ask' | 'always' | 'never') => {
    useStore.setState({ currentDoc: doc([node]), selectedNodeIds: [node.id] });
    return render(
        <SampleRowContext.Provider value={trustState(trust)}>
            <JsTab selected={[node]} />
        </SampleRowContext.Provider>,
    );
};

describe('JsTab — template trust (P6)', () => {
    it('disables template authoring with a reason when trust is never', () => {
        renderWithTrust(textNode({ kind: 'template', code: 'return 1', fallback: 'FB' }), 'never');
        expect((screen.getByLabelText('Template code') as HTMLTextAreaElement).disabled).toBe(true);
        expect(screen.getByTestId('js-template-blocked')).toBeTruthy();
    });

    it('allows template authoring under ask but flags the missing approval', () => {
        renderWithTrust(textNode({ kind: 'template', code: 'return 1', fallback: 'FB' }), 'ask');
        expect((screen.getByLabelText('Template code') as HTMLTextAreaElement).disabled).toBe(false);
        expect(screen.getByTestId('js-template-needs-approval')).toBeTruthy();
    });
});

describe('JsTab — never blocks a NEW template source (should-fix)', () => {
    it('does not offer a template option for a non-template node under never', () => {
        const node = textNode({ kind: 'static', value: 'hi' });
        renderWithTrust(node, 'never');

        const select = screen.getByLabelText('Content') as HTMLSelectElement;
        expect(Array.from(select.options).map((option) => option.value)).toEqual(['static', 'csv']);

        // A programmatic attempt (the option is gone, so the value is `''`) must
        // not fall through to creating a template source.
        fireEvent.change(select, { target: { value: 'template' } });
        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't1')! as { text: unknown };
        expect(persisted.text).toEqual({ kind: 'static', value: 'hi' });
    });

    it('keeps an existing template selectable under never so the user can switch away', () => {
        const node = textNode({ kind: 'template', code: 'return 1', fallback: 'FB' });
        renderWithTrust(node, 'never');

        const select = screen.getByLabelText('Content') as HTMLSelectElement;
        expect(Array.from(select.options).map((option) => option.value)).toContain('template');

        fireEvent.change(select, { target: { value: 'static' } });
        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't1')! as { text: unknown };
        expect(persisted.text).toEqual({ kind: 'static', value: '' });
    });

    it('still offers template authoring under ask and always', () => {
        renderWithTrust(textNode({ kind: 'static', value: 'hi' }), 'ask');
        expect(
            Array.from((screen.getByLabelText('Content') as HTMLSelectElement).options).map((o) => o.value),
        ).toContain('template');
        cleanup();
        renderWithTrust(textNode({ kind: 'static', value: 'hi' }), 'always');
        expect(
            Array.from((screen.getByLabelText('Content') as HTMLSelectElement).options).map((o) => o.value),
        ).toContain('template');
    });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { CsvRef, FieldDef, LabelDoc, Node } from '../../core/doc/types';
import { FieldsTab } from './FieldsTab';

/**
 * FieldsTab (P6a): every edit persists through the undoable store actions; the
 * list also surfaces bound-but-undeclared ids and the CSV row selector.
 */

const csvRef = (): CsvRef => ({
    csvId: 'csv-1',
    name: 'x.csv',
    source: { kind: 'local', mediaType: 'text/csv', resourceId: 'csv-1' },
});

const fieldNode = (name: string): Node => ({
    id: 't1',
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'field', name, fallback: '' },
});

const makeDoc = (fields?: FieldDef[], nodes: Node[] = []): LabelDoc => {
    const doc = createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });
    if (fields) doc.data.fields = fields;
    return doc;
};

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, docPast: [], docFuture: [] });
});

const renderTab = (doc: LabelDoc) => {
    useStore.setState({ currentDoc: doc });
    const view = render(<FieldsTab doc={doc} />);
    // The real `MfpPanel` re-renders on `currentDoc`; mirror that after a store
    // write so DOM-level assertions see the committed list.
    const sync = () => view.rerender(<FieldsTab doc={useStore.getState().currentDoc!} />);
    return { ...view, sync };
};

const row = (id: string) => screen.getByRole('group', { name: id });

describe('FieldsTab — declarations', () => {
    it('renders a declaration and commits a default edit as one undo entry', () => {
        renderTab(makeDoc([{ id: 'price' }]));

        const input = within(row('price')).getByLabelText('Default') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '$5' } });
        fireEvent.blur(input);

        expect(useStore.getState().currentDoc!.data.fields).toEqual([{ id: 'price', default: '$5' }]);
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('clears a default back to absent', () => {
        renderTab(makeDoc([{ id: 'price', default: '$5' }]));

        const input = within(row('price')).getByLabelText('Default') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.blur(input);

        expect(useStore.getState().currentDoc!.data.fields).toEqual([{ id: 'price' }]);
    });

    it('toggles required and hidden through the store', () => {
        const { sync } = renderTab(makeDoc([{ id: 'price' }]));

        fireEvent.click(within(row('price')).getByRole('checkbox', { name: 'Required' }));
        expect(useStore.getState().currentDoc!.data.fields).toEqual([{ id: 'price', required: true }]);

        sync();
        fireEvent.click(within(row('price')).getByRole('checkbox', { name: 'Hidden' }));
        expect(useStore.getState().currentDoc!.data.fields).toEqual([
            { id: 'price', required: true, hidden: true },
        ]);
        expect(useStore.getState().docPast).toHaveLength(2);

        // Unchecking removes the flag again instead of storing `false`.
        sync();
        fireEvent.click(within(row('price')).getByRole('checkbox', { name: 'Required' }));
        expect(useStore.getState().currentDoc!.data.fields).toEqual([{ id: 'price', hidden: true }]);
    });

    it('adds a field from the name input and removes it', () => {
        const { sync } = renderTab(makeDoc());

        fireEvent.change(screen.getByLabelText('Field name'), { target: { value: 'sku' } });
        fireEvent.click(screen.getByText('Add field'));
        expect(useStore.getState().currentDoc!.data.fields).toEqual([{ id: 'sku' }]);

        sync();
        fireEvent.click(within(row('sku')).getByText('Remove'));
        expect('fields' in useStore.getState().currentDoc!.data).toBe(false);
    });

    it('disables Add for a blank or duplicate name', () => {
        renderTab(makeDoc([{ id: 'price' }]));

        const add = screen.getByText('Add field') as HTMLButtonElement;
        const input = screen.getByLabelText('Field name');
        expect(add.disabled).toBe(true);

        fireEvent.change(input, { target: { value: '   ' } });
        expect(add.disabled).toBe(true);

        fireEvent.change(input, { target: { value: 'price' } });
        expect(add.disabled).toBe(true);

        fireEvent.change(input, { target: { value: 'price2' } });
        expect(add.disabled).toBe(false);
    });

    it('shows the reserved hint and no default input for a reserved row', () => {
        renderTab(makeDoc([{ id: 'csv.row' }]));

        const reserved = row('csv.row');
        expect(within(reserved).queryByLabelText('Default')).toBeNull();
        expect(within(reserved).getByText(/Reserved field/)).toBeTruthy();
    });
});

describe('FieldsTab — undeclared bindings', () => {
    it('lists a bound-but-undeclared name and declares it on demand', () => {
        const { sync } = renderTab(makeDoc(undefined, [fieldNode('price')]));

        expect(screen.getByText('Bound but not declared')).toBeTruthy();
        expect(screen.getByText('price')).toBeTruthy();

        fireEvent.click(screen.getByText('Add declaration'));
        expect(useStore.getState().currentDoc!.data.fields).toEqual([{ id: 'price' }]);
        // Declared now, so the section disappears.
        sync();
        expect(screen.queryByText('Bound but not declared')).toBeNull();
    });

    it('ignores a blank binding name', () => {
        renderTab(makeDoc(undefined, [fieldNode('')]));
        expect(screen.queryByText('Bound but not declared')).toBeNull();
    });
});

describe('FieldsTab — CSV row selector', () => {
    it('offers the row selector when a CSV is attached and it is not declared', () => {
        const doc = makeDoc();
        doc.data.csv = csvRef();
        const { sync } = renderTab(doc);

        expect(screen.getByText(/row selector chooses/)).toBeTruthy();
        fireEvent.click(screen.getByText('Add CSV row selector'));

        expect(useStore.getState().currentDoc!.data.fields).toEqual([{ id: 'csv.row' }]);
        sync();
        expect(screen.queryByText('Add CSV row selector')).toBeNull();
    });

    it('does not offer the row selector without a CSV', () => {
        renderTab(makeDoc());
        expect(screen.queryByText('Add CSV row selector')).toBeNull();
    });
});

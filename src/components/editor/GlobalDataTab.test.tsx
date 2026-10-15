// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { GlobalSpec } from '../../core/doc/types';
import { GlobalDataTab } from './GlobalDataTab';

/** GlobalDataTab (P6 W6): add/edit/remove write through undoable setDocGlobals. */

const makeDoc = (globals: GlobalSpec[] = []) => {
    const doc = createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes: [] });
    doc.data.globals = globals;
    return doc;
};

const seed: GlobalSpec = { kind: 'remote', name: 'store', url: 'https://x.test', extract: 'name', expiresAt: 10 };

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, docPast: [], docFuture: [] });
});

describe('GlobalDataTab', () => {
    it('adds a global through the store as one undo entry', () => {
        const doc = makeDoc();
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        fireEvent.click(screen.getByText('Add global'));

        const globals = useStore.getState().currentDoc!.data.globals;
        expect(globals).toHaveLength(1);
        // The new spec is seeded with a unique, editable placeholder name so it
        // survives the store's blank-name normalization.
        expect(globals[0]!.name).toBe('global1');
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('seeds a new global with a future cache expiry, not 0', () => {
        const doc = makeDoc();
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        fireEvent.click(screen.getByText('Add global'));

        const spec = useStore.getState().currentDoc!.data.globals[0]!;
        // `globals.ts` treats an entry as valid only while `expiresAt * 1000 >
        // now`; `0` means "never cached" and would refetch every pass. A fresh
        // spec must cache for the job.
        expect(spec.kind).toBe('remote');
        if (spec.kind !== 'remote') return;
        const now = Math.floor(Date.now() / 1000);
        expect(spec.expiresAt).toBeGreaterThan(now);
        expect(spec.expiresAt).toBeLessThanOrEqual(now + 300 + 5);
    });

    it('renders an existing global and commits an edit on blur', () => {
        const doc = makeDoc([seed]);
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: 'shop' } });
        fireEvent.blur(nameInput);

        expect(useStore.getState().currentDoc!.data.globals[0]!.name).toBe('shop');
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('commits a valid expiry edit as one undo entry', () => {
        const doc = makeDoc([seed]);
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        const expires = screen.getByLabelText('Expires at') as HTMLInputElement;
        fireEvent.change(expires, { target: { value: '42' } });
        fireEvent.blur(expires);

        expect(useStore.getState().currentDoc!.data.globals[0]).toMatchObject({ kind: 'remote', expiresAt: 42 });
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('surfaces an invalid expiry instead of silently committing 0', () => {
        const doc = makeDoc([seed]);
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        const expires = screen.getByLabelText('Expires at') as HTMLInputElement;
        fireEvent.change(expires, { target: { value: '' } });
        fireEvent.blur(expires);

        expect(screen.getByRole('alert')).toBeTruthy();
        // The committed spec is unchanged and no undo entry is created.
        expect(useStore.getState().currentDoc!.data.globals[0]).toMatchObject({ kind: 'remote', expiresAt: 10 });
        expect(useStore.getState().docPast).toHaveLength(0);
    });

    it('removes a global as one undo entry', () => {
        const doc = makeDoc([seed]);
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        fireEvent.click(screen.getByText('Remove'));

        expect(useStore.getState().currentDoc!.data.globals).toEqual([]);
        expect(useStore.getState().docPast).toHaveLength(1);
        useStore.getState().undoDoc();
        expect(useStore.getState().currentDoc!.data.globals).toHaveLength(1);
    });

    it('re-seeds drafts when the committed spec changes externally', async () => {
        const doc = makeDoc([seed]);
        useStore.setState({ currentDoc: doc });
        const view = render(<GlobalDataTab doc={doc} />);

        const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
        fireEvent.change(nameInput, { target: { value: 'unsaved' } });

        // An external change (e.g. undo/redo or a removal re-index) replaces the
        // spec; the draft must re-seed rather than overwrite the fresh value on
        // the next blur.
        const restored = makeDoc([{ ...seed, name: 'restored' }]);
        useStore.setState({ currentDoc: restored });
        view.rerender(<GlobalDataTab doc={restored} />);

        await waitFor(() =>
            expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('restored'),
        );
        fireEvent.blur(screen.getByLabelText('Name'));
        expect(useStore.getState().currentDoc!.data.globals[0]!.name).toBe('restored');
    });

    it('shows an empty state with no globals', () => {
        const doc = makeDoc();
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);
        expect(screen.getByText('No global data specs.')).toBeTruthy();
    });

    it('switches a remote row to static and swaps the fields', () => {
        const doc = makeDoc([seed]);
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        // Remote fields are visible up front.
        expect(screen.getByLabelText('URL')).toBeTruthy();
        expect(screen.getByLabelText('Extract')).toBeTruthy();

        fireEvent.change(screen.getByTestId('global-kind'), { target: { value: 'static' } });

        // Static fields replace the remote ones.
        expect(screen.queryByLabelText('URL')).toBeNull();
        expect(screen.queryByLabelText('Extract')).toBeNull();
        expect(screen.queryByLabelText('Expires at')).toBeNull();
        expect(screen.getByTestId('global-value')).toBeTruthy();
        expect(useStore.getState().currentDoc!.data.globals[0]).toMatchObject({
            kind: 'static',
            name: 'store',
        });
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('renders a static seed with a value input and no remote fields', () => {
        const doc = makeDoc([{ kind: 'static', name: 'store', value: 'Main' }]);
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        expect(screen.queryByLabelText('URL')).toBeNull();
        expect((screen.getByTestId('global-value') as HTMLInputElement).value).toBe('Main');
    });

    it('commits a static value edit as one undoable change', () => {
        const doc = makeDoc([{ kind: 'static', name: 'store', value: 'Main' }]);
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        const value = screen.getByTestId('global-value') as HTMLInputElement;
        fireEvent.change(value, { target: { value: 'Branch' } });
        fireEvent.blur(value);

        expect(useStore.getState().currentDoc!.data.globals).toEqual([
            { kind: 'static', name: 'store', value: 'Branch' },
        ]);
        expect(useStore.getState().docPast).toHaveLength(1);

        useStore.getState().undoDoc();
        expect(useStore.getState().currentDoc!.data.globals).toEqual([
            { kind: 'static', name: 'store', value: 'Main' },
        ]);
    });

    it('lays the cards out in an adaptive 3 → 2 → 1 column grid', () => {
        const doc = makeDoc([seed]);
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        const grid = screen.getByTestId('global-cards');
        expect(grid.className).toContain('grid-cols-1');
        expect(grid.className).toContain('lg:grid-cols-2');
        expect(grid.className).toContain('xl:grid-cols-3');
    });

    it('lets a compact card control fill the card width and puts name + kind on one row', () => {
        const doc = makeDoc([seed]);
        useStore.setState({ currentDoc: doc });
        render(<GlobalDataTab doc={doc} />);

        // The remote fields no longer use the fixed `w-36` that wasted the pane.
        const url = screen.getByLabelText('URL') as HTMLInputElement;
        expect(url.className).toContain('w-full');
        expect(url.className).not.toContain('w-36');

        // Name and kind share one header row inside the card.
        const name = screen.getByLabelText('Name');
        expect(name.parentElement).toBe((screen.getByTestId('global-kind') as HTMLElement).parentElement);
    });
});

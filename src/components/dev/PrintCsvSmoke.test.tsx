// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import App from '../../App';
import { PrintCsvSmoke } from './PrintCsvSmoke';

/**
 * Dev-harness test for `?printcsv=1` (the print-dialog CSV smoke).
 *
 * Kept jsdom-safe by stubbing the shared raster path (`renderLabelPage`), the
 * same seam `PrintDialog.test.tsx`/`usePrintThumbnails.test.tsx` use; no real
 * canvas and no browser automation.
 */

// No real canvas in happy-dom: the shared render path is stubbed to a data URL.
vi.mock('../../editor/render', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../editor/render')>();
    return {
        ...actual,
        renderLabelPage: vi.fn(async () => ({
            rgba: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
            widthPx: 1,
            heightPx: 1,
            canvas: {
                toDataURL: () => 'data:image/png;base64,stub',
            } as unknown as HTMLCanvasElement,
        })),
    };
});

// App's layout shell is irrelevant to the gate and drags in the store/IDB.
vi.mock('../layout/MainLayout', () => ({ MainLayout: () => null }));
vi.mock('../common/NotificationCenter', () => ({ NotificationCenter: () => null }));
vi.mock('../common/dialogs', () => ({ DialogHost: () => null }));
vi.mock('../common/GlobalShortcuts', () => ({ GlobalShortcuts: () => null }));

const setUrl = (search: string): void => {
    window.history.replaceState({}, '', `/${search}`);
};

afterEach(() => {
    cleanup();
    setUrl('');
    delete window.__printCsvSmoke;
});

describe('PrintCsvSmoke — ?printcsv=1 gate', () => {
    it('renders the harness when the param is present', async () => {
        setUrl('?printcsv=1');
        render(<App />);

        expect(await screen.findByTestId('printcsv-smoke')).toBeInTheDocument();
    });

    it('does not render the harness without the param', () => {
        setUrl('');
        render(<App />);

        expect(screen.queryByTestId('printcsv-smoke')).not.toBeInTheDocument();
    });

    it('coexists with ?mock=1', async () => {
        setUrl('?mock=1&printcsv=1');
        render(<App />);

        expect(await screen.findByTestId('printcsv-smoke')).toBeInTheDocument();
    });
});

describe('PrintCsvSmoke — dialog mounts over the in-memory CSV', () => {
    it('plans 3 rows / 3 pages and exposes the dev hook', async () => {
        render(<PrintCsvSmoke />);

        // The mock connects on mount; the dialog gates on its caps.
        await waitFor(() =>
            expect(screen.getByTestId('printcsv-state')).toHaveTextContent('connected'),
        );

        // D5: the dialog opens on the single-page preview; the record list is the
        // `Queue` view, which is what enumerates records over the in-memory CSV.
        expect(screen.getByTestId('print-page-preview')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('View as'), { target: { value: 'queue' } });

        expect(screen.getAllByTestId('print-page-row')).toHaveLength(3);
        expect(screen.getByText('3 pages total')).toBeInTheDocument();

        const hook = window.__printCsvSmoke;
        expect(hook).toBeDefined();
        expect(hook?.jobs()).toHaveLength(0);
        expect(hook?.lastResult).toBeNull();
        expect(hook?.isBusy).toBe(false);
    });
});

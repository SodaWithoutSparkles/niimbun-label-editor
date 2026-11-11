// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PageColorType } from '@mmote/niimbluelib';
import '../../i18n';
import { installCanvasShim } from '../../test/canvasHarness';
import { useStore } from '../../store/useStore';
import { DEFAULT_GRAYSCALE_TONE, DEFAULT_RED_BLACK_SETTINGS } from '../../store/storeDefaults';
import { PrintColoursSmoke } from './PrintColoursSmoke';

/**
 * Dev-harness test for `?printcolours` (P10): the harness must forward the
 * persisted grayscale band and red/black tuning into the job, gated on the
 * selected page colour, so its printed page matches the dialog (invariant 7).
 *
 * The shared raster path is stubbed (no real canvas), and the mock transport /
 * job builder are captured so the overrides can be asserted without a printer.
 */

const { buildCsvPrintJobMock, printMock } = vi.hoisted(() => ({
    buildCsvPrintJobMock: vi.fn(),
    printMock: vi.fn(),
}));

vi.mock('../../editor/render', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../editor/render')>();
    return {
        ...actual,
        renderLabelPage: vi.fn(async () => {
            // A real (shim-backed) canvas so the harness's `drawImage` succeeds.
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            return {
                rgba: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
                widthPx: 1,
                heightPx: 1,
                canvas,
            };
        }),
    };
});

vi.mock('../../print/printLabel', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../print/printLabel')>();
    return { ...actual, buildCsvPrintJob: buildCsvPrintJobMock };
});

vi.mock('../../print/mockTransport', () => ({
    MockTransport: class {
        onStatus(): () => void {
            return () => undefined;
        }
        onProgress(): () => void {
            return () => undefined;
        }
        async connect(): Promise<void> {}
        async disconnect(): Promise<void> {}
        print(job: unknown): Promise<{ pagesPrinted: number }> {
            return printMock(job) as Promise<{ pagesPrinted: number }>;
        }
    },
}));

const fakeJob = () => ({
    totalPages: 1,
    pageColor: 'stub',
    pages: (async function* () {
        yield { data: {}, quantity: 1 };
    })(),
});

const overridesOfLastCall = (): Record<string, unknown> =>
    (
        buildCsvPrintJobMock.mock.calls.at(-1)![2] as {
            overrides: Record<string, unknown>;
        }
    ).overrides;

beforeAll(() => {
    installCanvasShim();
});

beforeEach(() => {
    buildCsvPrintJobMock.mockReset();
    printMock.mockReset();
    buildCsvPrintJobMock.mockImplementation(() => fakeJob());
    printMock.mockResolvedValue({ pagesPrinted: 1 });
    useStore.setState({
        grayscaleTone: DEFAULT_GRAYSCALE_TONE,
        redBlackSettings: DEFAULT_RED_BLACK_SETTINGS,
    });
});

afterEach(() => {
    cleanup();
});

describe('PrintColoursSmoke — page tuning overrides (P10)', () => {
    it('forwards the grayscale band and full red/black tuning, gated on the page colour', async () => {
        useStore.setState({
            grayscaleTone: { minLevel: 5, maxLevel: 12 },
            redBlackSettings: {
                redIntensity: 1.2,
                blackDepth: 0.4,
                redCoverageMin: 60,
                redCoverageMax: 90,
            },
        });

        render(<PrintColoursSmoke />);
        // The default pattern is grayscale and the preview renders through the
        // shared path; the print button enables once it settles.
        const printButton = screen.getByRole('button', { name: 'Print 1 page' });
        await waitFor(() => expect(printButton).toBeEnabled());

        fireEvent.click(printButton);
        await waitFor(() => expect(buildCsvPrintJobMock).toHaveBeenCalledTimes(1));
        expect(overridesOfLastCall()).toMatchObject({
            pageColor: PageColorType.Grayscale,
            grayscaleTone: { minLevel: 5, maxLevel: 12 },
        });
        // Red/black tuning must not leak into a grayscale page.
        expect(overridesOfLastCall()).not.toHaveProperty('redBlack');

        // Red & black: the coverage band and intensity/depth ride along; the
        // grayscale band is gone.
        fireEvent.change(screen.getByLabelText(/Page colour/), {
            target: { value: String(PageColorType.DoubleColor) },
        });
        await waitFor(() => expect(printButton).toBeEnabled());
        fireEvent.click(printButton);
        await waitFor(() => expect(buildCsvPrintJobMock).toHaveBeenCalledTimes(2));
        expect(overridesOfLastCall()).toMatchObject({
            pageColor: PageColorType.DoubleColor,
            redBlack: {
                redIntensity: 1.2,
                blackDepth: 0.4,
                redCoverageMin: 60,
                redCoverageMax: 90,
            },
        });
        expect(overridesOfLastCall()).not.toHaveProperty('grayscaleTone');

        // Mono: neither key.
        fireEvent.change(screen.getByLabelText(/Page colour/), {
            target: { value: String(PageColorType.SingleColor) },
        });
        await waitFor(() => expect(printButton).toBeEnabled());
        fireEvent.click(printButton);
        await waitFor(() => expect(buildCsvPrintJobMock).toHaveBeenCalledTimes(3));
        expect(overridesOfLastCall()).not.toHaveProperty('redBlack');
        expect(overridesOfLastCall()).not.toHaveProperty('grayscaleTone');
    });
});

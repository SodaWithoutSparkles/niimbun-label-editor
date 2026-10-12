// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabelType } from '@mmote/niimbluelib';
import '../../i18n';
import { useStore } from '../../store/useStore';
import type {
    PrinterStatus,
    PrintJob,
    PrintProgress,
    PrintResult,
    PrinterTransport,
} from '../../print/transport';

/**
 * The chip must drive the ONE shared app transport, so the module is mocked to a
 * fake we control. `isMockMode` stays false: the real transport is never
 * auto-connected (Web Bluetooth needs a user gesture). `setAppTransportKind` is
 * part of the module's public surface, so it must be in the factory or the whole
 * file breaks for every consumer.
 */
const { transportRef, setKindMock } = vi.hoisted(() => ({
    transportRef: { current: undefined as unknown as PrinterTransport },
    setKindMock: vi.fn(async (_kind: string) => undefined),
}));

vi.mock('../../print/appTransport', () => ({
    getAppTransport: () => transportRef.current,
    setAppTransportKind: (kind: string) => setKindMock(kind),
    isMockMode: () => false,
}));

import { ConnectionChip } from './ConnectionChip';

const originalSetConnectMethod = useStore.getState().setConnectMethod;

class FakeTransport implements PrinterTransport {
    connectCalls = 0;
    disconnectCalls = 0;
    refreshCalls = 0;
    private readonly statusListeners = new Set<(status: PrinterStatus) => void>();

    async connect(): Promise<void> {
        this.connectCalls += 1;
        this.emit({ state: 'connected', deviceName: 'Fake' });
    }

    async disconnect(): Promise<void> {
        this.disconnectCalls += 1;
        this.emit({ state: 'disconnected' });
    }

    async refreshInfo(): Promise<void> {
        this.refreshCalls += 1;
    }

    async print(_job: PrintJob): Promise<PrintResult> {
        return { pagesPrinted: 0 };
    }

    onStatus(listener: (status: PrinterStatus) => void): () => void {
        this.statusListeners.add(listener);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    onProgress(_listener: (progress: PrintProgress) => void): () => void {
        return () => undefined;
    }

    emit(status: PrinterStatus): void {
        for (const listener of [...this.statusListeners]) listener(status);
    }
}

/** Connect reports an error status and rejects; the chip must not throw. */
class FailingTransport extends FakeTransport {
    override async connect(): Promise<void> {
        this.connectCalls += 1;
        this.emit({ state: 'error', error: 'Bluetooth refused' });
        throw new Error('Bluetooth refused');
    }
}

/** Toggle which browser transports `Utils.getAvailableTransports()` reports. */
const setSupported = (bluetooth: boolean, serial: boolean): void => {
    Object.defineProperty(navigator, 'bluetooth', {
        value: bluetooth ? { requestDevice: (): Promise<undefined> => Promise.resolve(undefined) } : undefined,
        configurable: true,
    });
    Object.defineProperty(navigator, 'serial', {
        value: serial ? { requestPort: (): Promise<undefined> => Promise.resolve(undefined) } : undefined,
        configurable: true,
    });
};

const trigger = (): HTMLElement =>
    screen.getByRole('button', { name: 'Printer connection status' });

/** A rich connected status covering every connected-panel field. */
const CONNECTED_STATUS: PrinterStatus = {
    state: 'connected',
    deviceName: 'Niimbot B1',
    batteryPercent: 82,
    hardwareVersion: '1.2.3',
    softwareVersion: '4.5.6',
    rollWidthHm: 4000,
    rollHeightHm: 3000,
    capabilities: { model: 'B1_PRO' },
    rfid: {
        tagPresent: true,
        usedPaper: 12,
        allPaper: 50,
        consumablesType: LabelType.WithGaps,
    },
};

/** Render the chip connected and open the popover (fresh render per test). */
const openConnected = async (transport: FakeTransport): Promise<void> => {
    transportRef.current = transport;
    render(<ConnectionChip />);
    await act(async () => undefined);
    act(() => {
        transport.emit(CONNECTED_STATUS);
    });
    fireEvent.click(trigger());
};

beforeEach(() => {
    setSupported(true, true);
    useStore.setState({
        printerStatus: { state: 'disconnected' },
        connectMethod: 'bluetooth',
        setConnectMethod: originalSetConnectMethod,
    });
    setKindMock.mockClear();
});

afterEach(() => {
    cleanup();
    useStore.setState({ printerStatus: { state: 'disconnected' } });
});

describe('ConnectionChip', () => {
    it('is the single printer indicator (one trigger button)', async () => {
        transportRef.current = new FakeTransport();
        render(<ConnectionChip />);
        await act(async () => undefined);

        expect(screen.getAllByRole('button', { name: 'Printer connection status' })).toHaveLength(1);
    });

    it("mirrors the shared transport's status into the chip", () => {
        const transport = new FakeTransport();
        transportRef.current = transport;
        render(<ConnectionChip />);

        act(() => {
            transport.emit({ state: 'connected', deviceName: 'Fake' });
        });

        expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('shows device version, RFID, battery and model in the connected popover', async () => {
        await openConnected(new FakeTransport());

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Niimbot B1')).toBeInTheDocument();
        expect(screen.getByText('B1_PRO')).toBeInTheDocument();
        expect(screen.getByText('1.2.3')).toBeInTheDocument();
        expect(screen.getByText('4.5.6')).toBeInTheDocument();
        expect(screen.getByText('12 / 50')).toBeInTheDocument();
        expect(screen.getByText('With gaps')).toBeInTheDocument();
        expect(screen.getByText('40×30 mm')).toBeInTheDocument();
        expect(screen.getByText('82%')).toBeInTheDocument();
    });

    it('refreshes printer info from the Refresh button', async () => {
        const transport = new FakeTransport();
        await openConnected(transport);

        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

        await waitFor(() => expect(transport.refreshCalls).toBe(1));
    });

    it('disconnects from the Disconnect button', async () => {
        const transport = new FakeTransport();
        await openConnected(transport);

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

        await waitFor(() => expect(transport.disconnectCalls).toBe(1));
    });

    it('hides a connect method the browser does not support', async () => {
        setSupported(false, true); // serial only
        transportRef.current = new FakeTransport();
        render(<ConnectionChip />);
        await act(async () => undefined);

        fireEvent.click(trigger());

        expect(screen.getByRole('button', { name: 'Serial (USB)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Bluetooth' })).toBeNull();
    });

    it('swaps the transport to the chosen kind, then connects', async () => {
        const transport = new FakeTransport();
        transportRef.current = transport;
        render(<ConnectionChip />);
        await act(async () => undefined);
        setKindMock.mockClear();

        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('button', { name: 'Serial (USB)' }));

        await waitFor(() => expect(transport.connectCalls).toBe(1));
        expect(setKindMock).toHaveBeenCalledWith('serial');
        expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('remembers the choice when the checkbox is ticked', async () => {
        const transport = new FakeTransport();
        transportRef.current = transport;
        const setConnectMethod = vi.fn();
        useStore.setState({ setConnectMethod });
        render(<ConnectionChip />);
        await act(async () => undefined);

        fireEvent.click(trigger());
        fireEvent.click(screen.getByLabelText('Remember this choice'));
        fireEvent.click(screen.getByRole('button', { name: 'Serial (USB)' }));

        await waitFor(() => expect(setConnectMethod).toHaveBeenCalledWith('serial'));
    });

    it('renders the open popover as a native <dialog open> (shortcut guard)', async () => {
        transportRef.current = new FakeTransport();
        render(<ConnectionChip />);
        await act(async () => undefined);

        expect(document.querySelector('dialog[open]')).toBeNull();
        fireEvent.click(trigger());
        expect(document.querySelector('dialog[open]')).not.toBeNull();
    });

    it('closes on Escape and returns focus to the chip', async () => {
        transportRef.current = new FakeTransport();
        render(<ConnectionChip />);
        await act(async () => undefined);

        const chip = trigger();
        fireEvent.click(chip);
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        fireEvent.keyDown(window, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(chip).toHaveFocus();
    });

    it('surfaces a connect failure as an error state without throwing', async () => {
        const transport = new FailingTransport();
        transportRef.current = transport;
        render(<ConnectionChip />);
        await act(async () => undefined);

        fireEvent.click(trigger());
        fireEvent.click(screen.getByRole('button', { name: 'Bluetooth' }));

        await waitFor(() => expect(screen.getByText('Printer error')).toBeInTheDocument());
        expect(transport.connectCalls).toBe(1);
    });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
 * auto-connected (Web Bluetooth needs a user gesture).
 */
const { transportRef } = vi.hoisted(() => ({
    transportRef: { current: undefined as unknown as PrinterTransport },
}));

vi.mock('../../print/appTransport', () => ({
    getAppTransport: () => transportRef.current,
    isMockMode: () => false,
}));

import { ConnectionChip } from './ConnectionChip';

class FakeTransport implements PrinterTransport {
    connectCalls = 0;
    disconnectCalls = 0;
    private readonly statusListeners = new Set<(status: PrinterStatus) => void>();

    async connect(): Promise<void> {
        this.connectCalls += 1;
        this.emit({ state: 'connected', deviceName: 'Fake' });
    }

    async disconnect(): Promise<void> {
        this.disconnectCalls += 1;
        this.emit({ state: 'disconnected' });
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

beforeEach(() => {
    useStore.setState({ printerStatus: { state: 'disconnected' } });
});

afterEach(() => {
    cleanup();
    useStore.setState({ printerStatus: { state: 'disconnected' } });
});

describe('ConnectionChip', () => {
    it("mirrors the shared transport's status into the chip", () => {
        const transport = new FakeTransport();
        transportRef.current = transport;
        render(<ConnectionChip />);

        act(() => {
            transport.emit({ state: 'connected', deviceName: 'Fake' });
        });

        expect(screen.getByText('Connected')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    });

    it('calls connect() on the shared transport from the Connect action', async () => {
        const transport = new FakeTransport();
        transportRef.current = transport;
        render(<ConnectionChip />);

        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        await waitFor(() => expect(transport.connectCalls).toBe(1));
        expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('surfaces a connect failure as an error state without throwing', async () => {
        const transport = new FailingTransport();
        transportRef.current = transport;
        render(<ConnectionChip />);

        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        await waitFor(() => expect(screen.getByText('Printer error')).toBeInTheDocument());
        expect(transport.connectCalls).toBe(1);
    });
});

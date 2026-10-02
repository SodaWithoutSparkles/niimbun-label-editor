import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { MockTransport } from '../../print/mockTransport';
import { cn } from '../../utils/cn';

/**
 * Printer connection status chip (top-right, both gallery and editor).
 *
 * P2 is status-only: it mirrors `PrinterTransport.onStatus` into the store's
 * `printerStatus`, which `BottomBar` also reads for the duplicated bottom-left
 * indicator. A module-level `MockTransport` stands in for the real transport
 * until printing lands; it never touches `@mmote/niimbluelib`.
 */
const transport = new MockTransport();

export const ConnectionChip: React.FC = () => {
    const { t } = useTranslation();
    const printerStatus = useStore((state) => state.printerStatus);
    const setPrinterStatus = useStore((state) => state.setPrinterStatus);
    // Guards the StrictMode effect replay so the mock is connected once per mount.
    const connectStarted = useRef(false);

    useEffect(() => {
        const unsubscribe = transport.onStatus(setPrinterStatus);
        if (!connectStarted.current) {
            connectStarted.current = true;
            void transport.connect();
        }
        return unsubscribe;
    }, [setPrinterStatus]);

    const connected = printerStatus.state === 'connected' || printerStatus.state === 'printing';
    const label = connected ? t('connection.connected') : t('connection.disconnected');

    return (
        <span
            role="status"
            aria-label={t('connection.statusAria')}
            title={label}
            className={cn(
                'flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs select-none',
                connected
                    ? 'border-emerald-700 bg-emerald-900/40 text-emerald-100'
                    : 'border-gray-600 bg-gray-800 text-gray-400',
            )}
        >
            <Printer size={12} />
            <span
                className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-gray-500')}
            />
            {label}
        </span>
    );
};

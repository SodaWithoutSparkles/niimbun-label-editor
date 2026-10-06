import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { getAppTransport, isMockMode } from '../../print/appTransport';
import { cn } from '../../utils/cn';

/**
 * Printer connection status chip (top-right, both gallery and editor).
 *
 * Mirrors the shared {@link getAppTransport} `onStatus` into the store's
 * `printerStatus`, which `BottomBar` also reads for the duplicated bottom-left
 * indicator, and exposes the Connect / Disconnect action.
 *
 * The real transport is **never** auto-connected: Web Bluetooth requires a user
 * gesture, so pairing starts from the Connect button. Only the dev mock
 * (`?mock=1`) auto-connects, matching the previous chip's always-connected
 * behaviour in dev.
 */
export const ConnectionChip: React.FC = () => {
    const { t } = useTranslation();
    const printerStatus = useStore((state) => state.printerStatus);
    const setPrinterStatus = useStore((state) => state.setPrinterStatus);
    const transport = useMemo(() => getAppTransport(), []);
    const [busy, setBusy] = useState(false);
    // Guards the StrictMode effect replay so the mock is connected once per mount.
    const autoConnectStarted = useRef(false);

    useEffect(() => {
        const unsubscribe = transport.onStatus(setPrinterStatus);
        if (isMockMode() && !autoConnectStarted.current) {
            autoConnectStarted.current = true;
            void transport.connect().catch(() => undefined);
        }
        return unsubscribe;
    }, [transport, setPrinterStatus]);

    const connected = printerStatus.state === 'connected' || printerStatus.state === 'printing';
    const connecting = printerStatus.state === 'connecting';
    const errored = printerStatus.state === 'error';
    const label = connected
        ? t('connection.connected')
        : connecting
          ? t('connection.connecting')
          : errored
            ? t('connection.error')
            : t('connection.disconnected');

    const toggle = async (): Promise<void> => {
        if (busy || connecting) return;
        setBusy(true);
        try {
            if (connected) await transport.disconnect();
            else await transport.connect();
        } catch {
            // A connect/disconnect rejection is mirrored through `onStatus`
            // (`state: 'error'`); swallow it here so the UI never sees an
            // unhandled rejection.
        } finally {
            setBusy(false);
        }
    };

    return (
        <span className="flex items-center gap-1.5 text-xs select-none">
            <span
                role="status"
                aria-label={t('connection.statusAria')}
                title={printerStatus.error ?? label}
                className={cn(
                    'flex items-center gap-1.5 rounded border px-2 py-0.5',
                    connected
                        ? 'border-emerald-700 bg-emerald-900/40 text-emerald-100'
                        : errored
                          ? 'border-red-700 bg-red-900/40 text-red-100'
                          : 'border-gray-600 bg-gray-800 text-gray-400',
                )}
            >
                <Printer size={12} />
                <span
                    className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        connected ? 'bg-emerald-400' : errored ? 'bg-red-400' : 'bg-gray-500',
                    )}
                />
                {label}
            </span>
            <button
                type="button"
                onClick={() => void toggle()}
                disabled={busy || connecting}
                className="rounded border border-gray-600 px-2 py-0.5 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
                {connected ? t('connection.disconnect') : t('connection.connect')}
            </button>
        </span>
    );
};

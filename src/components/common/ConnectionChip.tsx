import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bluetooth, Printer, RefreshCw, Usb } from 'lucide-react';
import { Utils } from '@mmote/niimbluelib';
import type { LabelType } from '@mmote/niimbluelib';
import { useStore } from '../../store/useStore';
import { getAppTransport, isMockMode, setAppTransportKind } from '../../print/appTransport';
import { hmToMm } from '../../core/hm';
import { labelTypeEnumName, labelTypeNameKey } from '../../print/labelTypeNames';
import type { ConnectMethod } from '../../store/storeTypes';
import { cn } from '../../utils/cn';

/**
 * Printer connection chip (top-right, both gallery and editor). This is the
 * single printer surface: the gallery's duplicate was deleted with `BottomBar`
 * in commit A.
 *
 * The chip mirrors the shared {@link getAppTransport} `onStatus` into the
 * store's `printerStatus` and is itself the trigger for a non-modal popover
 * (a native `<dialog open>`, so the codebase's `dialog[open]` shortcut guards
 * suppress editor shortcuts while it is open; Escape / click-outside / focus
 * return are handled locally, mirroring `EditorStatusBar`'s row popup). The
 * popover shows the connected printer's
 * info (device version, RFID label tag, battery) or, when disconnected, the
 * capability-gated connect chooser plus a "remember this choice" preference.
 *
 * The real transport is **never** auto-connected: Web Bluetooth/Serial require a
 * user gesture, so pairing starts from a chooser button. Only the dev mock
 * (`?mock=1`) auto-connects, matching the previous chip's always-connected
 * behaviour in dev.
 */

/** A label/value row, borrowed from the reference's `d-flex border rounded` blocks. */
const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-stretch overflow-hidden rounded border border-gray-600">
        <div className="flex shrink-0 items-center border-r border-gray-600 bg-gray-900 px-2 py-1 text-gray-400">
            {label}
        </div>
        <div className="flex grow items-center gap-1 px-2 py-1">{children}</div>
    </div>
);

/** 0–100 usage percent; 0 when the total is unknown or zero. */
const usagePercent = (used?: number, all?: number): number => {
    if (used === undefined || all === undefined || all <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((used / all) * 100)));
};

export const ConnectionChip: React.FC = () => {
    const { t } = useTranslation();
    const printerStatus = useStore((state) => state.printerStatus);
    const setPrinterStatus = useStore((state) => state.setPrinterStatus);
    const connectMethod = useStore((state) => state.connectMethod);
    const setConnectMethod = useStore((state) => state.setConnectMethod);

    // The module singleton is not reactive, so the live instance is held in
    // state and swapped in when the persisted kind changes (effect below).
    const [transport, setTransport] = useState(() => getAppTransport());
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [remember, setRemember] = useState(false);
    // Guards the StrictMode effect replay so the mock is connected once per mount.
    const autoConnectStarted = useRef(false);
    const popoverRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDialogElement>(null);

    // Sync the persisted kind into the shared transport (covers a change made in
    // the settings modal), then adopt whatever instance is now live. The
    // subscription effect below re-runs with the fresh instance.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            await setAppTransportKind(connectMethod);
            if (!cancelled) setTransport(getAppTransport());
        })();
        return () => {
            cancelled = true;
        };
    }, [connectMethod]);

    // Subscribe to whichever instance is currently held; a swap re-subscribes
    // and the previous unsubscribe cleans itself up. StrictMode-safe.
    useEffect(() => {
        const unsubscribe = transport.onStatus(setPrinterStatus);
        if (isMockMode() && !autoConnectStarted.current) {
            autoConnectStarted.current = true;
            void transport.connect().catch(() => undefined);
        }
        return unsubscribe;
    }, [transport, setPrinterStatus]);

    // Move focus into the popover when it opens.
    useEffect(() => {
        if (open) dialogRef.current?.focus();
    }, [open]);

    // Escape / click-outside, mirroring EditorStatusBar's row popup. The Escape
    // handler runs in the capture phase and stops propagation so the global
    // editor shortcuts do not also fire; a non-modal `<dialog open>` does not
    // auto-handle Escape, so this is required.
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setOpen(false);
            triggerRef.current?.focus();
        };
        const onPointerDown = (event: PointerEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) setOpen(false);
        };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('pointerdown', onPointerDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open]);

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

    // Which browser transports this session can actually use. Only the two
    // browser paths are surfaced; `capacitorBle` is the reference's mobile path.
    const available = Utils.getAvailableTransports();
    const methodAvailable: Record<ConnectMethod, boolean> = {
        bluetooth: available.webBluetooth,
        serial: available.webSerial,
    };
    // Highlight the remembered method when it is supported, otherwise fall back
    // to the other one (reference `PrinterConnector.svelte:93-101`).
    const otherMethod: ConnectMethod = connectMethod === 'bluetooth' ? 'serial' : 'bluetooth';
    const effectiveMethod: ConnectMethod | undefined = methodAvailable[connectMethod]
        ? connectMethod
        : methodAvailable[otherMethod]
          ? otherMethod
          : undefined;

    const consumableName = (type: LabelType | undefined): string | undefined => {
        if (type === undefined) return undefined;
        const key = labelTypeNameKey(type);
        return key ? t(key) : labelTypeEnumName(type);
    };

    /** Swap the shared transport to `kind` (if needed), then connect. */
    const connectWith = async (kind: ConnectMethod): Promise<void> => {
        if (busy || connecting || !methodAvailable[kind]) return;
        setBusy(true);
        try {
            await setAppTransportKind(kind);
            const next = getAppTransport();
            setTransport(next);
            if (remember) setConnectMethod(kind);
            await next.connect();
        } catch {
            // A connect rejection is mirrored through `onStatus`
            // (`state: 'error'`); swallow it here so the UI never sees an
            // unhandled rejection.
        } finally {
            setBusy(false);
        }
    };

    const refresh = async (): Promise<void> => {
        if (busy) return;
        setBusy(true);
        try {
            await transport.refreshInfo?.();
        } catch {
            // refreshInfo re-emits through `onStatus`; swallow the rejection.
        } finally {
            setBusy(false);
        }
    };

    const disconnect = async (): Promise<void> => {
        if (busy) return;
        setBusy(true);
        try {
            await transport.disconnect();
        } catch {
            // Mirrored through `onStatus`; swallow.
        } finally {
            setBusy(false);
        }
    };

    const rfid = printerStatus.rfid;
    const consumable = consumableName(rfid?.consumablesType);
    const showDimensions =
        printerStatus.rollWidthHm !== undefined && printerStatus.rollHeightHm !== undefined;

    return (
        <div className="relative" ref={popoverRef}>
            <button
                ref={triggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={t('connection.statusAria')}
                title={printerStatus.error ?? label}
                onClick={() => setOpen((value) => !value)}
                className={cn(
                    'flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs select-none',
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
            </button>

            {open && (
                <dialog
                    ref={dialogRef}
                    open
                    data-popover
                    tabIndex={-1}
                    aria-label={t('connection.statusAria')}
                    className="absolute top-full right-0 left-auto z-40 m-0 mt-1 w-72 rounded border border-gray-600 bg-gray-800 p-2 text-xs text-gray-300 shadow-xl outline-none"
                >
                    {connected ? (
                        <div className="flex flex-col gap-2">
                            <Row label={t('connection.device')}>
                                <span className="grow text-white">
                                    {printerStatus.deviceName ?? '—'}
                                </span>
                                {printerStatus.capabilities?.model && (
                                    <span className="shrink-0 rounded bg-gray-900 px-1.5 py-0.5 font-mono text-gray-400">
                                        {printerStatus.capabilities.model}
                                    </span>
                                )}
                            </Row>

                            <div>
                                <div className="mb-1 text-gray-400">
                                    {t('connection.deviceVersion')}
                                </div>
                                <Row label={t('connection.hw')}>
                                    <span className="grow text-center text-white">
                                        {printerStatus.hardwareVersion ?? '—'}
                                    </span>
                                    <span className="grow border-l border-gray-600 text-center text-white">
                                        {printerStatus.softwareVersion ?? '—'}
                                    </span>
                                    <span className="border-l border-gray-600 pl-2 text-gray-400">
                                        {t('connection.fw')}
                                    </span>
                                </Row>
                            </div>

                            <div>
                                <div className="mb-1 text-gray-400">{t('connection.rfidPaper')}</div>
                                {rfid?.tagPresent ? (
                                    <div className="flex flex-col gap-1">
                                        <Row label={t('connection.rfidUsage')}>
                                            <div className="h-1.5 grow overflow-hidden rounded bg-gray-700">
                                                <div
                                                    className="h-full bg-emerald-500"
                                                    style={{
                                                        width: `${usagePercent(rfid.usedPaper, rfid.allPaper)}%`,
                                                    }}
                                                />
                                            </div>
                                            <span className="shrink-0 text-gray-300">
                                                {rfid.usedPaper ?? '—'} / {rfid.allPaper ?? '—'}
                                            </span>
                                        </Row>
                                        {consumable !== undefined && (
                                            <Row label={t('connection.rfidType')}>
                                                <span className="grow text-center text-white">
                                                    {consumable}
                                                </span>
                                            </Row>
                                        )}
                                        {showDimensions && (
                                            <Row label={t('connection.rfidDimensions')}>
                                                <span className="grow text-center text-white">
                                                    {hmToMm(printerStatus.rollWidthHm!)}×
                                                    {hmToMm(printerStatus.rollHeightHm!)} mm
                                                </span>
                                            </Row>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-gray-500">{t('connection.rfidNoTag')}</div>
                                )}
                            </div>

                            <Row label={t('connection.battery')}>
                                <span className="grow text-center text-white">
                                    {printerStatus.batteryPercent !== undefined
                                        ? `${printerStatus.batteryPercent}%`
                                        : '—'}
                                </span>
                            </Row>

                            <div className="flex justify-end gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => void refresh()}
                                    disabled={busy}
                                    className="flex items-center gap-1 rounded border border-gray-600 px-2 py-0.5 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                                >
                                    <RefreshCw size={12} />
                                    {t('connection.refresh')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void disconnect()}
                                    disabled={busy}
                                    className="rounded border border-red-700 px-2 py-0.5 text-red-200 hover:bg-red-900/40 disabled:opacity-50"
                                >
                                    {t('connection.disconnect')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div className="text-gray-400">{t('connection.chooserTitle')}</div>
                            <div className="flex flex-wrap gap-2">
                                {available.webBluetooth && (
                                    <button
                                        type="button"
                                        onClick={() => void connectWith('bluetooth')}
                                        disabled={busy || connecting}
                                        className={cn(
                                            'flex items-center gap-1.5 rounded border px-2 py-1 disabled:opacity-50',
                                            effectiveMethod === 'bluetooth'
                                                ? 'border-emerald-700 bg-emerald-900/40 text-emerald-100'
                                                : 'border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-700',
                                        )}
                                    >
                                        <Bluetooth size={12} />
                                        {t('connection.bluetooth')}
                                    </button>
                                )}
                                {available.webSerial && (
                                    <button
                                        type="button"
                                        onClick={() => void connectWith('serial')}
                                        disabled={busy || connecting}
                                        className={cn(
                                            'flex items-center gap-1.5 rounded border px-2 py-1 disabled:opacity-50',
                                            effectiveMethod === 'serial'
                                                ? 'border-emerald-700 bg-emerald-900/40 text-emerald-100'
                                                : 'border-gray-600 bg-gray-900 text-gray-300 hover:bg-gray-700',
                                        )}
                                    >
                                        <Usb size={12} />
                                        {t('connection.serial')}
                                    </button>
                                )}
                            </div>
                            {(busy || connecting || errored) && (
                                <div
                                    className={cn(
                                        'text-xs',
                                        errored ? 'text-red-300' : 'text-gray-400',
                                    )}
                                >
                                    {errored
                                        ? (printerStatus.error ?? t('connection.error'))
                                        : t('connection.connecting')}
                                </div>
                            )}
                            <label className="flex items-center gap-2 text-gray-300">
                                <input
                                    type="checkbox"
                                    checked={remember}
                                    onChange={(event) => setRemember(event.target.checked)}
                                />
                                {t('connection.remember')}
                            </label>
                        </div>
                    )}
                </dialog>
            )}
        </div>
    );
};

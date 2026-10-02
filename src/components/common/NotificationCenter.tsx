import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import type { Notification } from '../../store/storeTypes';

const TYPE_STYLES: Record<string, { border: string; bg: string; text: string }> = {
    info: { border: 'border-blue-500/80', bg: 'bg-blue-900/80', text: 'text-white' },
    success: { border: 'border-emerald-500/80', bg: 'bg-emerald-900/80', text: 'text-white' },
    warning: { border: 'border-amber-500/80', bg: 'bg-amber-900/80', text: 'text-white' },
    error: { border: 'border-red-500/80', bg: 'bg-red-900/80', text: 'text-white' }
};

export const NotificationCenter: React.FC = () => {
    const { t } = useTranslation();
    const notifications = useStore((state) => state.notifications);
    const removeNotification = useStore((state) => state.removeNotification);
    const timeoutsRef = useRef<Map<string, number>>(new Map());
    const containerRef = useRef<HTMLDivElement>(null);

    const ids = useMemo(() => new Set(notifications.map((n: Notification) => n.id)), [notifications]);
    const hasNotifications = notifications.length > 0;

    // Paint above any open modal. An open <dialog>'s ::backdrop is in the top
    // layer, which outranks every z-indexed element, so z-[200] alone loses.
    // A `popover="manual"` element also enters the top layer, so put the toast
    // container there. `manual` means no light-dismiss, non-modal: it does not
    // steal focus and does not block canvas clicks. Feature-detected so
    // browsers without the API fall back to the fixed + z-index behaviour.
    //
    // Top-layer paint order is INSERTION order, not z-index: a modal shown
    // AFTER the popover paints over it. So keep the popover permanently open
    // (once, on mount) and re-insert it (hide + show) whenever a dialog opens,
    // moving it to the top of the insertion order so it paints above the
    // newly-opened modal. Feature-detected for browsers without the API.
    const ensurePopoverOpen = useCallback(() => {
        const el = containerRef.current;
        if (!el || typeof el.showPopover !== 'function') return;
        try {
            if (el.matches(':popover-open')) el.hidePopover();
            el.showPopover();
        } catch {
            // Already open (or not a valid popover target): nothing to do.
        }
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || typeof el.showPopover !== 'function') return;
        // Idempotent for React 19 StrictMode (same discipline as Modal).
        if (!el.matches(':popover-open')) {
            try {
                el.showPopover();
            } catch {
                // Already open or not a valid popover target -- nothing to do.
            }
        }
    }, []);

    // A dialog opened after the popover sits higher in the top layer and buries
    // the toast under its backdrop. Re-insert the popover on every dialog that
    // gains `[open]`, so it lands above. StrictMode/idempotency-safe because
    // `ensurePopoverOpen` hide-then-shows only when already open.
    useEffect(() => {
        if (typeof MutationObserver === 'undefined') return;
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                const target = record.target as HTMLElement;
                if (target.tagName === 'DIALOG' && target.hasAttribute('open')) {
                    ensurePopoverOpen();
                    return;
                }
            }
        });
        observer.observe(document.body, {
            subtree: true,
            attributes: true,
            attributeFilter: ['open'],
        });
        return () => observer.disconnect();
    }, [ensurePopoverOpen]);

    // The common case: a save/load failure raises a toast WHILE a modal is
    // already open. The observer above only fires when a dialog *opens*, so
    // re-insert here whenever the toast set grows and a dialog is currently open.
    useEffect(() => {
        if (!hasNotifications) return;
        if (document.querySelector('dialog[open]')) ensurePopoverOpen();
    }, [notifications, hasNotifications, ensurePopoverOpen]);

    // While a modal <dialog> is open it makes every other top-layer element
    // inert, so the toast paints above the backdrop but cannot receive clicks:
    // hit-testing falls through to the dialog's ::backdrop, and Modal treats a
    // click on the backdrop as "close". (Measured: elementFromPoint over the
    // toast returns DIALOG, and a real click there closed Settings.)
    // `pointer-events: none` does NOT fix this -- it still routes the click to
    // the backdrop. So swallow pointer/click events that land inside the
    // visible toast box while a dialog is open, at the window capture phase
    // (earliest in the event path), so they never reach the dialog's close
    // handler. The toast stays visible but non-interactive under a modal, which
    // is the documented, acceptable behaviour.
    useEffect(() => {
        if (!hasNotifications) return;
        const swallowIfOverToast = (e: Event) => {
            const el = containerRef.current;
            if (!el || el.children.length === 0) return;
            if (!document.querySelector('dialog[open]')) return;
            const mouse = e as MouseEvent;
            if (typeof mouse.clientX !== 'number') return;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return;
            const over =
                mouse.clientX >= r.left &&
                mouse.clientX <= r.right &&
                mouse.clientY >= r.top &&
                mouse.clientY <= r.bottom;
            if (!over) return;
            e.stopPropagation();
            e.preventDefault();
        };
        window.addEventListener('pointerdown', swallowIfOverToast, true);
        window.addEventListener('mousedown', swallowIfOverToast, true);
        window.addEventListener('click', swallowIfOverToast, true);
        return () => {
            window.removeEventListener('pointerdown', swallowIfOverToast, true);
            window.removeEventListener('mousedown', swallowIfOverToast, true);
            window.removeEventListener('click', swallowIfOverToast, true);
        };
    }, [hasNotifications]);

    useEffect(() => {
        notifications.forEach((n: Notification) => {
            if (timeoutsRef.current.has(n.id)) return;
            const timeout = n.timeout ?? (n.type === 'error' ? 8000 : 5000);
            const timerId = window.setTimeout(() => {
                removeNotification(n.id);
            }, timeout);
            timeoutsRef.current.set(n.id, timerId);
        });

        timeoutsRef.current.forEach((timerId, id) => {
            if (!ids.has(id)) {
                window.clearTimeout(timerId);
                timeoutsRef.current.delete(id);
            }
        });
    }, [notifications, ids, removeNotification]);

    // Always render the container so the popover can be opened once on mount
    // and its ref stays stable. Empty state is zero-footprint: `[&:empty]:hidden`
    // plus the hasNotifications-driven `hidden` keep a smuggled `.flex` from
    // making an empty container visible (same cascade discipline as Modal).
    //
    // `bg-transparent text-inherit` defeat the UA `[popover] { background-color:
    // Canvas; color: CanvasText }` rule (which beats preflight), so the
    // container is not a white block and toast cards keep their own colors.
    return createPortal(
        <div
            ref={containerRef}
            popover="manual"
            className={`fixed top-4 right-4 z-[200] flex-col gap-2 max-w-sm w-[min(90vw,420px)] m-0 [inset:auto] bg-transparent text-inherit border-0 p-0 ${hasNotifications ? 'flex' : 'hidden'} [&:empty]:hidden`}
        >
            {notifications.map((n: Notification) => {
                const style = TYPE_STYLES[n.type] ?? TYPE_STYLES.info;
                return (
                    <div
                        key={n.id}
                        className={`border ${style.border} ${style.bg} ${style.text} rounded-lg shadow-lg px-4 py-3 backdrop-blur`}
                        role="status"
                        aria-live="polite"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                                {n.title && (
                                    <div className="font-semibold text-sm mb-1">
                                        {n.title}
                                    </div>
                                )}
                                <div className="text-sm leading-snug">
                                    {n.message}
                                </div>
                                {n.detail && (
                                    <div className="mt-1 text-xs text-white/90 break-words">
                                        {n.detail}
                                    </div>
                                )}
                            </div>
                            <button
                                className="text-white/80 hover:text-white text-sm"
                                onClick={() => removeNotification(n.id)}
                                aria-label={t('notification.dismiss')}
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>,
        document.body
    );
};

import React, { useEffect, useSyncExternalStore } from 'react';
import { getPending, resolvePending, subscribe } from './dialogService';
import { ConfirmDialog } from './ConfirmDialog';
import { PromptDialog } from './PromptDialog';
import { AlertDialog } from './AlertDialog';

/**
 * The unmount-settle token, shared across host instances so a root remount can
 * cancel a settle scheduled by the instance it replaced (a per-instance ref
 * could not reach it).
 */
let unmountSettleToken: { cancelled: boolean } | null = null;

/**
 * Renders whichever dialog the service currently has pending.
 *
 * Mounted at the app root. On unmount (a derived app tearing down the React
 * root) it settles the pending request as cancelled, so the caller's `await`
 * resolves instead of hanging forever. Each request is keyed by its id, so a
 * displaced dialog remounts with fresh state rather than reusing a stale one.
 */
export const DialogHost: React.FC = () => {
    const pending = useSyncExternalStore(subscribe, getPending);

    // No request may outlive the host: settle as cancelled on unmount. Defer the
    // settle by a microtask and cancel it when the effect is set up again.
    //
    // The cancel only wins for a same-flush replay (StrictMode / act /
    // flushSync), where the re-setup runs before the microtask checkpoint. A
    // genuinely new React root flushes passive effects in a later task, so the
    // microtask settles first. That path is still safe -- it settles as
    // cancelled (no hang), it just does not preserve the new host's dialog.
    //
    // The token lives at module scope, not in a ref: a genuine root unmount +
    // immediate remount in the same tick creates a fresh component instance with
    // a fresh ref, which could not cancel the old instance's microtask. A shared
    // slot lets the new host mark the old settle superseded so it does not
    // settle a request the new host is now displaying.
    useEffect(() => {
        if (unmountSettleToken) unmountSettleToken.cancelled = true;
        const token = { cancelled: false };
        unmountSettleToken = token;
        return () => {
            queueMicrotask(() => {
                if (!token.cancelled) resolvePending();
            });
        };
    }, []);

    if (!pending) return null;

    switch (pending.kind) {
        case 'confirm':
            return (
                <ConfirmDialog
                    key={pending.id}
                    open
                    title={pending.options.title}
                    message={pending.options.message}
                    confirmLabel={pending.options.confirmLabel}
                    cancelLabel={pending.options.cancelLabel}
                    danger={pending.options.danger}
                    onConfirm={() => resolvePending(true)}
                    onCancel={() => resolvePending(false)}
                />
            );
        case 'prompt':
            return (
                <PromptDialog
                    key={pending.id}
                    open
                    title={pending.options.title}
                    message={pending.options.message}
                    defaultValue={pending.options.defaultValue}
                    placeholder={pending.options.placeholder}
                    confirmLabel={pending.options.confirmLabel}
                    cancelLabel={pending.options.cancelLabel}
                    danger={pending.options.danger}
                    onSubmit={(value) => resolvePending(value)}
                    onCancel={() => resolvePending(null)}
                />
            );
        case 'alert':
            return (
                <AlertDialog
                    key={pending.id}
                    open
                    title={pending.options.title}
                    message={pending.options.message}
                    confirmLabel={pending.options.confirmLabel}
                    onConfirm={() => resolvePending()}
                />
            );
    }
};

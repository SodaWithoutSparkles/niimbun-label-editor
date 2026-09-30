import React, { useEffect, useSyncExternalStore } from 'react';
import { getPending, resolvePending, subscribe } from './dialogService';
import { ConfirmDialog } from './ConfirmDialog';
import { PromptDialog } from './PromptDialog';
import { AlertDialog } from './AlertDialog';

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

    // No request may outlive the host: settle as cancelled on unmount.
    useEffect(() => () => resolvePending(), []);

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

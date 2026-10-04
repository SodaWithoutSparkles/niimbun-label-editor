import React, { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../utils/cn';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title?: string;
    ariaLabel?: string;        // used when there is no title
    headerActions?: ReactNode; // rendered to the LEFT of the built-in close button
    footer?: ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    className?: string;
    /**
     * When true, every dismissal path (X / Escape / backdrop / cancel) is inert.
     * The caller stays in control of `open`; used to keep a dialog open while an
     * async operation is in flight.
     */
    closeDisabled?: boolean;
    children: ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl'
};

/**
 * Shared dialog base built on the native <dialog> element.
 *
 * showModal() puts the dialog in the top layer, which gives focus trap, focus
 * restore and background inertness for free -- no focus-trap library, no body
 * scroll lock, no z-index hacks. It is portaled to document.body so it escapes
 * ancestor overflow-hidden / stacking contexts and so clicks inside it do not
 * bubble into layout-level handlers (e.g. the Header menu backdrop).
 */
export const Modal: React.FC<ModalProps> = ({
    open,
    onClose,
    title,
    ariaLabel,
    headerActions,
    footer,
    size = 'md',
    className,
    closeDisabled = false,
    children
}) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    // Where the pointer went down: a text-selection drag can start inside the
    // dialog and end on the backdrop, which must not count as a backdrop click.
    const pressedBackdropRef = useRef(false);
    // The element focused when the dialog opened, so focus can be restored on
    // close (native <dialog> does not do this reliably in every setup).
    const openerRef = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const { t } = useTranslation();

    // Tracks a microtask-deferred unmount restore. Cancelled when the effect is
    // set up again so StrictMode's mount/cleanup replay does not steal focus.
    const unmountRestoreRef = useRef<{ cancelled: boolean } | null>(null);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        // A replayed setup means the host is mounted again (StrictMode), or the
        // dialog merely re-opened: supersede any pending unmount restore.
        if (unmountRestoreRef.current) unmountRestoreRef.current.cancelled = true;
        // Idempotent guards: StrictMode runs effects twice.
        if (open && !dialog.open) {
            // Capture the opener only when there is none recorded, so the
            // StrictMode setup replay does not overwrite it with the dialog's
            // own (now focused) first descendant.
            if (openerRef.current === null) {
                openerRef.current =
                    document.activeElement instanceof HTMLElement ? document.activeElement : null;
            }
            dialog.showModal();
        } else if (!open && dialog.open) {
            dialog.close();
        }

        // The dialog can unmount while still open (the promise dialogs are
        // rendered with `open` hardcoded true and unmounted by DialogHost). The
        // open->false effect below then never runs, so restore the opener here
        // on genuine unmount. Defer by a microtask and cancel in the re-setup
        // above, so a StrictMode replay (cleanup then immediate re-run) does not
        // pull focus back out of the still-open dialog.
        return () => {
            if (!open) return;
            const token = { cancelled: false };
            unmountRestoreRef.current = token;
            queueMicrotask(() => {
                if (token.cancelled) return;
                const opener = openerRef.current;
                openerRef.current = null;
                if (!opener || !opener.isConnected) return;
                // Do not fight a native restore that landed somewhere real.
                const active = document.activeElement;
                if (active && active !== document.body) return;
                try {
                    opener.focus();
                } catch {
                    // Opener became unfocusable before the dialog unmounted.
                }
            });
        };
    }, [open]);

    // Restore focus to the opener on close. Native <dialog> is supposed to do
    // this, but the portal + React unmount ordering leaves focus on <body>.
    // Runs only while closed, so it fires once per real open->close transition.
    useEffect(() => {
        if (open) return;
        const opener = openerRef.current;
        openerRef.current = null;
        if (!opener || !opener.isConnected) return;
        // Do not fight the native restore: only act if focus escaped to body.
        const active = document.activeElement;
        if (active && active !== document.body) return;
        try {
            opener.focus();
        } catch {
            // Opener became unfocusable between open and close -- nothing to do.
        }
    }, [open]);

    const requestClose = () => {
        // A caller-managed in-flight operation can veto every dismissal path.
        if (closeDisabled) return;
        const dialog = dialogRef.current;
        // Closing the dialog synchronously here lets the browser's native
        // Escape default action run afterwards and pop the *next* stacked
        // <dialog>. preventDefault() on this keydown cancels that default
        // action, so only the top dialog closes.
        if (dialog?.open) dialog.close();
        onClose();
    };

    const dialog = (
        <dialog
            ref={dialogRef}
            // For a real Escape-generated `cancel`, cancel the native close too;
            // otherwise the browser proceeds to close a lower stacked dialog.
            onCancel={(e) => {
                e.preventDefault();
                if (!closeDisabled) onClose();
            }}
            // Native Escape handling is unreliable (and unfocused-input cases
            // vary by browser), so close explicitly on any Escape inside the
            // dialog. preventDefault stops the browser's native default action
            // (which would close the next dialog down the stack); stopPropagation
            // keeps the press from also reaching the window-level listeners that
            // use Escape as a canvas cancel key.
            onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                requestClose();
            }}
            // Clicks land on the dialog itself only when they hit the backdrop,
            // but the press must have started there too.
            onPointerDown={(e) => {
                pressedBackdropRef.current = e.target === e.currentTarget;
            }}
            onClick={(e) => {
                if (pressedBackdropRef.current && e.target === e.currentTarget && !closeDisabled) onClose();
            }}
            aria-label={title ? undefined : ariaLabel}
            aria-labelledby={title ? titleId : undefined}
            className={cn(
                'max-h-[85vh] w-full flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900 p-0 text-white shadow-2xl backdrop:bg-black/60',
                // FX2 -- deterministic viewport centring. Preflight resets `* { margin: 0 }`,
                // which clobbers the UA's `dialog { margin: auto }`, and the modal (top-layer)
                // position must not depend on UA insets either. A definite size (h-fit, plus
                // w-full capped by max-w-*) + four-sided inset + auto margins centres the box
                // on both axes in every browser, without an explicit height, so the flex body
                // still scrolls under max-h-[85vh] and the header/footer stay pinned.
                'fixed inset-0 m-auto h-fit',
                // FX1 -- author CSS beats the UA stylesheet regardless of specificity, so the
                // flex layout may only exist while the dialog is open. Closed => no author
                // `display` utility at all, so the UA's `dialog:not([open]) { display: none }`
                // applies.
                open && 'flex',
                // Close-side frame: covers the window between the `open` prop going false and
                // the ref effect running `dialog.close()`, before [open] is removed from the DOM.
                !open && 'hidden',
                // Guard: 0,2,0 specificity, so a display utility smuggled in via SIZE_CLASSES
                // or a caller className (0,1,0) still cannot make a closed dialog visible.
                '[&:not([open])]:hidden',
                SIZE_CLASSES[size],
                className
            )}
        >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-700 px-6 py-4">
                {title && <h2 id={titleId} className="text-lg font-semibold">{title}</h2>}
                <div className="ml-auto flex items-center gap-2">
                    {headerActions}
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={closeDisabled}
                        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={t('dialog.close')}
                        title={t('dialog.close')}
                    >
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>

            {footer && (
                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-700 px-6 py-4">
                    {footer}
                </div>
            )}
        </dialog>
    );

    return createPortal(dialog, document.body);
};

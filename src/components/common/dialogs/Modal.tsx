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
    children
}) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    // Where the pointer went down: a text-selection drag can start inside the
    // dialog and end on the backdrop, which must not count as a backdrop click.
    const pressedBackdropRef = useRef(false);
    const titleId = useId();
    const { t } = useTranslation();

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        // Idempotent guards: StrictMode runs effects twice.
        if (open && !dialog.open) dialog.showModal();
        else if (!open && dialog.open) dialog.close();
    }, [open]);

    const dialog = (
        <dialog
            ref={dialogRef}
            onCancel={onClose}
            // Native Escape handling is unreliable (and unfocused-input cases
            // vary by browser), so close explicitly on any Escape inside the
            // dialog. stopPropagation keeps the press from also reaching the
            // window-level listeners that use Escape as a canvas cancel key.
            onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                e.stopPropagation();
                onClose();
            }}
            // Clicks land on the dialog itself only when they hit the backdrop,
            // but the press must have started there too.
            onPointerDown={(e) => {
                pressedBackdropRef.current = e.target === e.currentTarget;
            }}
            onClick={(e) => {
                if (pressedBackdropRef.current && e.target === e.currentTarget) onClose();
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
                        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
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

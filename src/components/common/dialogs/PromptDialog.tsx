import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '../forms/Input';
import { Modal } from './Modal';

interface PromptDialogProps {
    open: boolean;
    title?: string;
    message: string;
    defaultValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onSubmit: (value: string) => void;
    onCancel: () => void;
}

const CANCEL_BUTTON_CLASS =
    'rounded bg-gray-700 px-4 py-2 text-sm text-white transition-colors hover:bg-gray-600';

/**
 * Single-line text prompt. Enter submits, Escape cancels -- all other overlay
 * behaviour lives in the shared Modal.
 */
export const PromptDialog: React.FC<PromptDialogProps> = ({
    open,
    title,
    message,
    defaultValue,
    placeholder,
    confirmLabel,
    cancelLabel,
    danger = false,
    onSubmit,
    onCancel
}) => {
    const { t } = useTranslation();
    const [value, setValue] = useState(defaultValue ?? '');
    const submittedRef = useRef(false);
    // Input does not forward a ref, so focus through its wrapper element.
    const inputWrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        // Modal calls showModal() in its own effect, which moves focus to the
        // first focusable descendant (the header close button). Re-assert focus
        // on the input after that, on the next frame.
        const frame = requestAnimationFrame(() => {
            const input = inputWrapRef.current?.firstElementChild;
            if (input instanceof HTMLInputElement) input.focus();
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);

    const handleSubmit = () => {
        // The dialog unmounts on submit, but a double click can land twice
        // before React re-renders.
        if (submittedRef.current) return;
        submittedRef.current = true;
        onSubmit(value);
    };

    return (
        <Modal
            open={open}
            onClose={onCancel}
            title={title}
            ariaLabel={title ? undefined : message}
            size="sm"
            footer={
                <div className="flex w-full items-center justify-between gap-2">
                    <button type="button" onClick={onCancel} className={CANCEL_BUTTON_CLASS}>
                        {cancelLabel ?? t('dialog.cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        className={
                            danger
                                ? 'rounded bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-500'
                                : 'rounded bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-500'
                        }
                    >
                        {confirmLabel ?? t('dialog.ok')}
                    </button>
                </div>
            }
        >
            <label className="block space-y-2">
                <span className="block whitespace-pre-line text-sm text-gray-200">{message}</span>
                <div ref={inputWrapRef}>
                    <Input
                        value={value}
                        onChange={setValue}
                        placeholder={placeholder}
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                e.stopPropagation();
                                handleSubmit();
                            } else if (e.key === 'Escape') {
                                e.stopPropagation();
                                onCancel();
                            }
                        }}
                    />
                </div>
            </label>
        </Modal>
    );
};

export type { PromptDialogProps };

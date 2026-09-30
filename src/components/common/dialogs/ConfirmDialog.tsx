import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../utils/cn';
import { Modal } from './Modal';

interface ConfirmDialogProps {
    open: boolean;
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const CANCEL_BUTTON_CLASS =
    'rounded bg-gray-700 px-4 py-2 text-sm text-white transition-colors hover:bg-gray-600';

/**
 * Confirm/cancel dialog. All overlay behaviour (Escape, backdrop, focus trap)
 * lives in the shared Modal.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open,
    title,
    message,
    confirmLabel,
    cancelLabel,
    danger = false,
    onConfirm,
    onCancel
}) => {
    const { t } = useTranslation();

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
                        onClick={onConfirm}
                        className={cn(
                            'rounded px-4 py-2 text-sm text-white transition-colors',
                            danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
                        )}
                    >
                        {confirmLabel ?? t('dialog.ok')}
                    </button>
                </div>
            }
        >
            <p className="whitespace-pre-line text-sm text-gray-200">{message}</p>
        </Modal>
    );
};

export type { ConfirmDialogProps };

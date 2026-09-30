import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';

interface AlertDialogProps {
    open: boolean;
    title?: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
}

/** Message with a single confirming button. Overlay behaviour lives in Modal. */
export const AlertDialog: React.FC<AlertDialogProps> = ({
    open,
    title,
    message,
    confirmLabel,
    onConfirm
}) => {
    const { t } = useTranslation();

    return (
        <Modal
            open={open}
            onClose={onConfirm}
            title={title}
            ariaLabel={title ? undefined : message}
            size="sm"
            footer={
                <button
                    type="button"
                    onClick={onConfirm}
                    className="rounded bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-500"
                >
                    {confirmLabel ?? t('dialog.ok')}
                </button>
            }
        >
            <p className="whitespace-pre-line text-sm text-gray-200">{message}</p>
        </Modal>
    );
};

export type { AlertDialogProps };

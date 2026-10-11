import React from 'react';
import { cn } from '../../../utils/cn';
import { Modal } from './Modal';
import type { ChoiceAction } from './dialogService';

interface ChoiceDialogProps {
    open: boolean;
    title?: string;
    message: string;
    actions: ReadonlyArray<ChoiceAction>;
    /** Called with the chosen action's value. */
    onSelect: (value: string) => void;
    /** Every dismissal path (Escape / backdrop / X) routes here. */
    onCancel: () => void;
}

const BUTTON_CLASS = 'rounded px-4 py-2 text-sm text-white transition-colors';

const actionClass = (variant: ChoiceAction['variant']): string => {
    if (variant === 'danger') return cn(BUTTON_CLASS, 'bg-red-600 hover:bg-red-500');
    if (variant === 'primary') return cn(BUTTON_CLASS, 'bg-blue-600 hover:bg-blue-500');
    return cn(BUTTON_CLASS, 'bg-gray-700 hover:bg-gray-600');
};

/**
 * Multi-choice dialog. Each action resolves the pending request with its own
 * value; the Modal's close/cancel path resolves the request's cancel value.
 * Overlay behaviour (Escape, backdrop, focus trap) lives in the shared Modal.
 */
export const ChoiceDialog: React.FC<ChoiceDialogProps> = ({
    open,
    title,
    message,
    actions,
    onSelect,
    onCancel,
}) => (
    <Modal
        open={open}
        onClose={onCancel}
        title={title}
        ariaLabel={title ? undefined : message}
        size="sm"
        footer={
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
                {actions.map((action) => (
                    <button
                        key={action.value}
                        type="button"
                        onClick={() => onSelect(action.value)}
                        className={actionClass(action.variant)}
                    >
                        {action.label}
                    </button>
                ))}
            </div>
        }
    >
        <p className="whitespace-pre-line text-sm text-gray-200">{message}</p>
    </Modal>
);

export type { ChoiceDialogProps };

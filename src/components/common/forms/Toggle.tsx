import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../../utils/cn';

interface ToggleProps
    extends Omit<
        ButtonHTMLAttributes<HTMLButtonElement>,
        'onChange' | 'className' | 'type' | 'role' | 'aria-checked'
    > {
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
}

export function Toggle({ checked, onChange, className, onClick, ...rest }: ToggleProps) {
    return (
        <button
            {...rest}
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={(e) => {
                onChange(!checked);
                onClick?.(e);
            }}
            className={cn(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-blue-500',
                'disabled:cursor-not-allowed disabled:opacity-50',
                checked ? 'bg-blue-600' : 'bg-gray-600',
                className
            )}
        >
            <span
                className={cn(
                    'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                    checked ? 'translate-x-4' : 'translate-x-0.5'
                )}
            />
        </button>
    );
}

export type { ToggleProps };

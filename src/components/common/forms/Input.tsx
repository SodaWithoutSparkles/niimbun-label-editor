import type { InputHTMLAttributes } from 'react';
import { cn } from '../../../utils/cn';

interface InputProps
    extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'className'> {
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export function Input({ value, onChange, className, ...rest }: InputProps) {
    return (
        <input
            {...rest}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
                'w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 transition-colors',
                'placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
                'disabled:cursor-not-allowed disabled:opacity-50',
                className
            )}
        />
    );
}

export type { InputProps };

import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../../utils/cn';

interface SelectOption {
    value: string;
    label: string;
}

interface SelectProps
    extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'className' | 'children'> {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    className?: string;
}

export function Select({ value, onChange, options, className, ...rest }: SelectProps) {
    return (
        <select
            {...rest}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
                'rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 transition-colors',
                'focus:outline-none focus:ring-1 focus:ring-blue-500',
                'disabled:cursor-not-allowed disabled:opacity-50',
                className
            )}
        >
            {options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    );
}

export type { SelectProps, SelectOption };

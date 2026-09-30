import type { ReactNode } from 'react';
import { cn } from '../../../utils/cn';

interface SettingRowProps {
    label: string;
    description?: string;
    children: ReactNode;
    htmlFor?: string;
    className?: string;
}

export function SettingRow({
    label,
    description,
    children,
    htmlFor,
    className,
}: SettingRowProps) {
    const text = (
        <>
            <span className="text-sm text-gray-300">{label}</span>
            {description && (
                <span className="mt-0.5 text-xs text-gray-500">{description}</span>
            )}
        </>
    );

    return (
        <div className={cn('flex items-center justify-between gap-4 py-2', className)}>
            {htmlFor ? (
                <label htmlFor={htmlFor} className="flex flex-col">
                    {text}
                </label>
            ) : (
                <div className="flex flex-col">{text}</div>
            )}
            <div className="flex shrink-0 items-center">{children}</div>
        </div>
    );
}

export type { SettingRowProps };

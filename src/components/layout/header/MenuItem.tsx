import React from 'react';

interface MenuItemProps {
    label: string;
    onClick: () => void;
    shortcut?: string;
    checked?: boolean;
    disabled?: boolean;
}

export const MenuItem: React.FC<MenuItemProps> = ({
    label,
    onClick,
    shortcut,
    checked,
    disabled
}) => (
    <div
        className={`px-4 py-2 flex justify-between min-w-[160px] ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-700 cursor-pointer'}`}
        onClick={(e) => {
            e.stopPropagation();
            if (disabled) return;
            onClick();
        }}
    >
        <div className="flex items-center">
            {checked !== undefined && (
                <span className="w-4 mr-2 text-blue-400">{checked ? '✓' : ''}</span>
            )}
            <span>{label}</span>
        </div>
        {shortcut && <span className="text-gray-500 text-xs ml-4 my-auto">{shortcut}</span>}
    </div>
);

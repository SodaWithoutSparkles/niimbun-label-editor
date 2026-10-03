import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Type, Image as ImageIcon, Square, QrCode, Barcode, ChevronDown, Minus, Circle, Pentagon } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import type { InsertAction } from '../../store/slices/toolsSlice';

/**
 * Insert rail (ui-spec.md §4): one-shot insert actions, ~48 px, top-only.
 * `Select` is the resting state and has no button; an armed action turns the
 * preview cursor into a crosshair and clears back to select after placing.
 *
 * Image / QR / Barcode are disabled — their engines are P5/P4.
 */

/** Literal map so dynamic rail ids keep i18next's typed-key union. */
const INSERT_LABEL_KEYS = {
    text: 'editor.insert.text',
    image: 'editor.insert.image',
    qr: 'editor.insert.qr',
    barcode: 'editor.insert.barcode',
} as const;

const SHAPE_LABEL_KEYS = {
    'shape:line': 'editor.insert.line',
    'shape:rectangle': 'editor.insert.rectangle',
    'shape:ellipse': 'editor.insert.ellipse',
    'shape:polygon': 'editor.insert.polygon',
} as const;

const SHAPE_ICONS = {
    'shape:line': Minus,
    'shape:rectangle': Square,
    'shape:ellipse': Circle,
    'shape:polygon': Pentagon,
} as const;

interface RailButtonProps {
    action: InsertAction;
    label: string;
    disabled?: boolean;
    active: boolean;
    onArm: (action: InsertAction) => void;
    children: React.ReactNode;
    title?: string;
}

const RailButton: React.FC<RailButtonProps> = ({ action, label, disabled, active, onArm, children, title }) => (
    <button
        type="button"
        disabled={disabled}
        aria-label={label}
        title={title ?? label}
        aria-pressed={active}
        onClick={() => onArm(action)}
        className={cn(
            'flex h-10 w-10 items-center justify-center rounded transition-colors',
            disabled
                ? 'cursor-not-allowed text-gray-600'
                : active
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white',
        )}
    >
        {children}
    </button>
);

export const InsertRail: React.FC = () => {
    const { t } = useTranslation();
    const activeTool = useStore((state) => state.activeTool);
    const setActiveTool = useStore((state) => state.setActiveTool);
    const clearActiveTool = useStore((state) => state.clearActiveTool);
    const [shapeMenuOpen, setShapeMenuOpen] = useState(false);

    const arm = (action: InsertAction) => {
        // Clicking the already-armed action disarms back to select.
        if (activeTool === action) clearActiveTool();
        else setActiveTool(action);
        setShapeMenuOpen(false);
    };

    const shapeArmed = activeTool.startsWith('shape:');

    return (
        <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-gray-700 bg-gray-800 py-2">
            <RailButton action="text" label={t(INSERT_LABEL_KEYS.text)} active={activeTool === 'text'} onArm={arm}>
                <Type size={20} />
            </RailButton>

            <RailButton
                action="image"
                label={t(INSERT_LABEL_KEYS.image)}
                disabled
                title={`${t(INSERT_LABEL_KEYS.image)} — ${t('editor.insert.disabledEngine')}`}
                active={false}
                onArm={arm}
            >
                <ImageIcon size={20} />
            </RailButton>

            <div className="relative">
                <button
                    type="button"
                    aria-label={t('editor.insert.shape')}
                    aria-haspopup="menu"
                    aria-expanded={shapeMenuOpen}
                    aria-pressed={shapeArmed}
                    title={t('editor.insert.shape')}
                    onClick={() => setShapeMenuOpen((open) => !open)}
                    className={cn(
                        'flex h-10 w-10 items-center justify-center rounded transition-colors',
                        shapeArmed ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white',
                    )}
                >
                    <Square size={20} />
                    <ChevronDown size={10} className="absolute bottom-1 right-1" />
                </button>
                {shapeMenuOpen && (
                    <>
                        <div className="fixed inset-0 z-30" onClick={() => setShapeMenuOpen(false)} />
                        <div
                            role="menu"
                            className="absolute left-full top-0 z-40 ml-1 min-w-[140px] rounded border border-gray-600 bg-gray-800 py-1 shadow-xl"
                        >
                            {(Object.keys(SHAPE_LABEL_KEYS) as (keyof typeof SHAPE_LABEL_KEYS)[]).map((action) => {
                                const Icon = SHAPE_ICONS[action];
                                return (
                                    <button
                                        key={action}
                                        type="button"
                                        role="menuitem"
                                        onClick={() => arm(action)}
                                        className={cn(
                                            'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                                            activeTool === action
                                                ? 'bg-blue-600 text-white'
                                                : 'text-gray-200 hover:bg-gray-700',
                                        )}
                                    >
                                        <Icon size={14} />
                                        {t(SHAPE_LABEL_KEYS[action])}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            <RailButton
                action="qr"
                label={t(INSERT_LABEL_KEYS.qr)}
                disabled
                title={`${t(INSERT_LABEL_KEYS.qr)} — ${t('editor.insert.disabledEngine')}`}
                active={false}
                onArm={arm}
            >
                <QrCode size={20} />
            </RailButton>

            <RailButton
                action="barcode"
                label={t(INSERT_LABEL_KEYS.barcode)}
                disabled
                title={`${t(INSERT_LABEL_KEYS.barcode)} — ${t('editor.insert.disabledEngine')}`}
                active={false}
                onArm={arm}
            >
                <Barcode size={20} />
            </RailButton>
        </div>
    );
};

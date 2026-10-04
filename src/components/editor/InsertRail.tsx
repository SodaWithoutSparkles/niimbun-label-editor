import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Type, Image as ImageIcon, Square, QrCode, Barcode, ChevronDown, Minus, Circle, Pentagon } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import type { hm } from '../../core/hm';
import type { ImageRef } from '../../core/doc/types';
import type { InsertAction } from '../../store/slices/toolsSlice';
import { createImageNodeForRef } from '../../editor/insertActions';
import { ImageImportDialog } from './ImageImportDialog';

/**
 * Insert rail (ui-spec.md §4): one-shot insert actions, ~48 px, top-only.
 * `Select` is the resting state and has no button; an armed action turns the
 * preview cursor into a crosshair and clears back to select after placing.
 *
 * Image opens the import dialog (file or URL) and places the imported asset at
 * the label centre, sized to its aspect. QR / barcode arm click-to-place with a
 * default static payload and a sensible symbol box (P5).
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
    const currentDoc = useStore((state) => state.currentDoc);
    const addNode = useStore((state) => state.addNode);
    const addImageRef = useStore((state) => state.addImageRef);
    const selectNode = useStore((state) => state.selectNode);
    const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
    const [imageDialogOpen, setImageDialogOpen] = useState(false);

    const arm = (action: InsertAction) => {
        // Clicking the already-armed action disarms back to select.
        if (activeTool === action) clearActiveTool();
        else setActiveTool(action);
        setShapeMenuOpen(false);
    };

    const shapeArmed = activeTool.startsWith('shape:');

    /** Register an imported image and place it centred, sized to its aspect. */
    const handleImageImported = (ref: ImageRef) => {
        if (!currentDoc) return;
        addImageRef(ref);
        const maxSide = Math.max(500, Math.min(currentDoc.label.backingW, currentDoc.label.backingH) - 200);
        const node = createImageNodeForRef(0, 0, ref, maxSide as hm);
        const w = node.size?.w ?? 0;
        const h = node.size?.h ?? 0;
        node.transform.x = Math.round((currentDoc.label.backingW - w) / 2);
        node.transform.y = Math.round((currentDoc.label.backingH - h) / 2);
        const id = addNode(node);
        if (id) selectNode(id);
    };

    return (
        <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-gray-700 bg-gray-800 py-2">
            <RailButton action="text" label={t(INSERT_LABEL_KEYS.text)} active={activeTool === 'text'} onArm={arm}>
                <Type size={20} />
            </RailButton>

            <RailButton
                action="image"
                label={t(INSERT_LABEL_KEYS.image)}
                active={false}
                onArm={() => setImageDialogOpen(true)}
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

            <RailButton action="qr" label={t(INSERT_LABEL_KEYS.qr)} active={activeTool === 'qr'} onArm={arm}>
                <QrCode size={20} />
            </RailButton>

            <RailButton
                action="barcode"
                label={t(INSERT_LABEL_KEYS.barcode)}
                active={activeTool === 'barcode'}
                onArm={arm}
            >
                <Barcode size={20} />
            </RailButton>

            <ImageImportDialog
                open={imageDialogOpen}
                onClose={() => setImageDialogOpen(false)}
                onImported={handleImageImported}
            />
        </div>
    );
};

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlignCenter,
    AlignHorizontalDistributeCenter,
    AlignHorizontalJustifyCenter,
    AlignHorizontalJustifyEnd,
    AlignHorizontalJustifyStart,
    AlignLeft,
    AlignRight,
    AlignVerticalDistributeCenter,
    AlignVerticalJustifyCenter,
    AlignVerticalJustifyEnd,
    AlignVerticalJustifyStart,
    Grid3x3,
    Magnet,
    Maximize,
    RotateCw,
    Ruler as RulerIcon,
    Scan,
    ZoomIn,
    ZoomOut,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { ZOOM_MIN, ZOOM_MAX } from '../../editor/viewportController';
import { useArrange } from './useArrange';
import type { AlignEdge, TileAxis } from '../../editor/arrange';
import type { Node, TextAlign } from '../../core/doc/types';

/**
 * View controls (ui-spec.md §6) — right column, row A. Grid, snap, zoom
 * −/+/fit/real, rotate-view and rulers. All view-only; nothing here mutates the
 * document.
 *
 * Below the general VIEW block sits the **object-specific** icon block
 * (action-plan D2): align 6 + tile 2, shown only with a selection, plus the
 * text-align trio for a text node. The commands live in `useArrange` and the
 * geometry in `editor/arrange`, so this block and the Object tab share one
 * implementation. Icon-only buttons keep an accessible name from the same i18n
 * keys the Object tab's removed ALIGN section used.
 */

type IconType = React.ComponentType<{ size?: number }>;

interface IconButtonProps {
    label: string;
    /** Omitted for a momentary action (no `aria-pressed`); a boolean is a toggle. */
    active?: boolean;
    onClick: () => void;
    children: React.ReactNode;
    title?: string;
}

const IconButton: React.FC<IconButtonProps> = ({ label, active, onClick, children, title }) => (
    <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        title={title ?? label}
        onClick={onClick}
        className={cn(
            'flex h-8 w-8 items-center justify-center rounded transition-colors',
            active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white',
        )}
    >
        {children}
    </button>
);

/** i18n keys for the selection align/tile icons (literal map, typed keys). */
const ALIGN_LABEL_KEYS = {
    left: 'editor.mfp.alignLeft',
    center: 'editor.mfp.alignCenter',
    right: 'editor.mfp.alignRight',
    top: 'editor.mfp.alignTop',
    middle: 'editor.mfp.alignMiddle',
    bottom: 'editor.mfp.alignBottom',
} as const satisfies Record<AlignEdge, string>;

const TILE_LABEL_KEYS = {
    vertical: 'editor.mfp.tileVertical',
    horizontal: 'editor.mfp.tileHorizontal',
} as const satisfies Record<TileAxis, string>;

/** Node text alignment (`node.align`). No `justify`: the model/renderer has none. */
const TEXT_ALIGN_LABEL_KEYS = {
    left: 'editor.mfp.textAlignLeft',
    center: 'editor.mfp.textAlignCenter',
    right: 'editor.mfp.textAlignRight',
} as const satisfies Record<TextAlign, string>;

/**
 * Selection align + tile glyphs. lucide has no `distribute` *action* (R10b), so
 * the closest glyph is the `justify`/`distribute` family: the six edges map to
 * the justify-start/center/end icons on each axis, and tiling maps to the
 * distribute-center icons (spreading nodes along the axis).
 */
const ALIGN_ACTIONS: ReadonlyArray<{ edge: AlignEdge; Icon: IconType }> = [
    { edge: 'left', Icon: AlignHorizontalJustifyStart },
    { edge: 'center', Icon: AlignHorizontalJustifyCenter },
    { edge: 'right', Icon: AlignHorizontalJustifyEnd },
    { edge: 'top', Icon: AlignVerticalJustifyStart },
    { edge: 'middle', Icon: AlignVerticalJustifyCenter },
    { edge: 'bottom', Icon: AlignVerticalJustifyEnd },
];

const TILE_ACTIONS: ReadonlyArray<{ axis: TileAxis; Icon: IconType }> = [
    { axis: 'vertical', Icon: AlignVerticalDistributeCenter },
    { axis: 'horizontal', Icon: AlignHorizontalDistributeCenter },
];

const TEXT_ALIGN_ACTIONS: ReadonlyArray<{ value: TextAlign; Icon: IconType }> = [
    { value: 'left', Icon: AlignLeft },
    { value: 'center', Icon: AlignCenter },
    { value: 'right', Icon: AlignRight },
];

export const ViewControls: React.FC = () => {
    const { t } = useTranslation();
    const gridVisible = useStore((state) => state.gridVisible);
    const toggleGrid = useStore((state) => state.toggleGrid);
    const snapEnabled = useStore((state) => state.snapEnabled);
    const toggleSnap = useStore((state) => state.toggleSnap);
    const rulersVisible = useStore((state) => state.rulersVisible);
    const toggleRulers = useStore((state) => state.toggleRulers);
    const viewRotation = useStore((state) => state.viewRotation);
    const toggleViewRotation = useStore((state) => state.toggleViewRotation);
    const zoomMode = useStore((state) => state.zoomMode);
    const effectiveZoom = useStore((state) => state.effectiveZoom);
    const setZoomMode = useStore((state) => state.setZoomMode);
    const setManualZoom = useStore((state) => state.setManualZoom);

    // Selection drives the object-specific block. `selectedNodeIds` is the only
    // selection model (selectionSlice); the nodes come from the open document.
    const doc = useStore((state) => state.currentDoc);
    const selectedNodeIds = useStore((state) => state.selectedNodeIds);
    const selected = useMemo<Node[]>(
        () => (doc ? doc.nodes.filter((node) => selectedNodeIds.includes(node.id)) : []),
        [doc, selectedNodeIds],
    );
    const { align, tile, setTextAlign } = useArrange(selected);
    const firstText = selected.find((node) => node.type === 'text');

    const step = (factor: number) =>
        setManualZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, effectiveZoom * factor)));

    return (
        <div className="flex flex-col gap-2 border-b border-gray-700 bg-gray-800 p-2">
            <div className="px-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {t('editor.view.title')}
            </div>
            <div className="flex flex-wrap items-center gap-1">
                <IconButton label={t('editor.view.grid')} active={gridVisible} onClick={toggleGrid}>
                    <Grid3x3 size={16} />
                </IconButton>
                <IconButton label={t('editor.view.snap')} active={snapEnabled} onClick={toggleSnap}>
                    <Magnet size={16} />
                </IconButton>
                <IconButton label={t('editor.view.rulers')} active={rulersVisible} onClick={toggleRulers}>
                    <RulerIcon size={16} />
                </IconButton>
                <IconButton
                    label={t('editor.view.rotate')}
                    active={viewRotation === 90}
                    onClick={toggleViewRotation}
                >
                    <RotateCw size={16} />
                </IconButton>
            </div>
            <div className="flex flex-wrap items-center gap-1">
                <IconButton label={t('editor.view.zoomOut')} active={false} onClick={() => step(1 / 1.2)}>
                    <ZoomOut size={16} />
                </IconButton>
                <IconButton label={t('editor.view.zoomIn')} active={false} onClick={() => step(1.2)}>
                    <ZoomIn size={16} />
                </IconButton>
                <IconButton
                    label={t('editor.view.fit')}
                    active={zoomMode === 'fit'}
                    onClick={() => setZoomMode('fit')}
                >
                    <Maximize size={16} />
                </IconButton>
                <IconButton
                    label={t('editor.view.real')}
                    active={zoomMode === 'real'}
                    onClick={() => setZoomMode('real')}
                >
                    <Scan size={16} />
                </IconButton>
            </div>

            {selected.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-gray-700 pt-2">
                    <div className="px-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                        {t('editor.mfp.align')}
                    </div>
                    <div className="flex flex-wrap items-center gap-1" data-testid="object-align-icons">
                        {ALIGN_ACTIONS.map(({ edge, Icon }) => (
                            <IconButton
                                key={edge}
                                label={t(ALIGN_LABEL_KEYS[edge])}
                                onClick={() => align(edge)}
                            >
                                <Icon size={16} />
                            </IconButton>
                        ))}
                        {TILE_ACTIONS.map(({ axis, Icon }) => (
                            <IconButton
                                key={axis}
                                label={t(TILE_LABEL_KEYS[axis])}
                                onClick={() => tile(axis)}
                            >
                                <Icon size={16} />
                            </IconButton>
                        ))}
                    </div>
                    {firstText && (
                        <div className="flex flex-wrap items-center gap-1" data-testid="text-align-icons">
                            {TEXT_ALIGN_ACTIONS.map(({ value, Icon }) => (
                                <IconButton
                                    key={value}
                                    label={t(TEXT_ALIGN_LABEL_KEYS[value])}
                                    active={(firstText.align ?? 'left') === value}
                                    onClick={() => setTextAlign(value)}
                                >
                                    <Icon size={16} />
                                </IconButton>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Grid3x3, Magnet, ZoomIn, ZoomOut, Maximize, Ruler as RulerIcon, RotateCw, Scan } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';

/**
 * View controls (ui-spec.md §6) — right column, row A. Grid, snap, zoom
 * −/+/fit/real, rotate-view and rulers. All view-only; nothing here mutates the
 * document.
 */

interface ToggleButtonProps {
    label: string;
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    title?: string;
}

const IconButton: React.FC<ToggleButtonProps> = ({ label, active, onClick, children, title }) => (
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

    const step = (factor: number) => setManualZoom(Math.max(0.005, effectiveZoom * factor));

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
        </div>
    );
};

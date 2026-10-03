import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { ConnectionChip } from '../common/ConnectionChip';
import { realZoom } from '../../core/viewport';

/**
 * Editor status bar (ui-spec.md §9): zoom %, DPI, row-selector popup and the
 * connection chip. The row selector is a plain popover (not a dialog); its
 * Escape and click-outside handling are local and `stopPropagation` so the
 * global editor shortcuts do not also fire.
 *
 * Zoom % is expressed relative to real physical size (`realZoom` from the
 * Screen-DPI calibration): 100% means the label measures its true size on
 * screen.
 */

export const EditorStatusBar: React.FC = () => {
    const { t } = useTranslation();
    const doc = useStore((state) => state.currentDoc);
    const effectiveZoom = useStore((state) => state.effectiveZoom);
    const screenDpi = useStore((state) => state.screenDpi);
    const setSampleRowIndex = useStore((state) => state.setSampleRowIndex);
    const [rowOpen, setRowOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);

    const real = realZoom(screenDpi);
    // `effectiveZoom` is 0 until the Preview binds the real viewport. Rendering
    // a percent from that placeholder would flash "Zoom: 0%"; show "—" instead.
    const zoomPercent =
        real > 0 && effectiveZoom > 0 ? Math.round((effectiveZoom / real) * 100) : null;
    const rowIndex = doc?.data.sampleRowIndex ?? 0;
    const hasCsv = Boolean(doc?.data.csv);

    useEffect(() => {
        if (!rowOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setRowOpen(false);
        };
        const onPointerDown = (event: PointerEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) setRowOpen(false);
        };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('pointerdown', onPointerDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('pointerdown', onPointerDown);
        };
    }, [rowOpen]);

    const jump = (index: number) => {
        setSampleRowIndex(index);
    };

    return (
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-gray-700 bg-gray-900 px-3 text-xs text-gray-300 select-none">
            <div className="flex items-center gap-2">
                <span className="rounded border border-gray-600 bg-gray-800 px-2 py-0.5" title={t('editor.status.zoom')}>
                    {t('editor.status.zoom')}: <span className="font-medium text-white">{zoomPercent === null ? '—' : `${zoomPercent}%`}</span>
                </span>
                <span className="rounded border border-gray-600 bg-gray-800 px-2 py-0.5" title={t('editor.status.dpi')}>
                    {t('editor.status.dpi')}: <span className="font-medium text-white">{screenDpi}</span>
                </span>

                <div className="relative" ref={popoverRef}>
                    <button
                        type="button"
                        onClick={() => setRowOpen((open) => !open)}
                        title={hasCsv ? t('editor.status.rowPopupTitle') : t('editor.status.noCsv')}
                        className="flex items-center gap-1 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 transition-colors hover:bg-gray-700"
                    >
                        {t('editor.status.row')}: {hasCsv ? rowIndex : '—'}
                        <ChevronDown size={12} />
                    </button>
                    {rowOpen && (
                        <div className="absolute bottom-full left-0 z-40 mb-1 w-56 rounded border border-gray-600 bg-gray-800 p-2 shadow-xl">
                            {hasCsv && doc ? (
                                <div className="flex items-center justify-between gap-2">
                                    <button
                                        type="button"
                                        onClick={() => jump(rowIndex - 1)}
                                        className="rounded bg-gray-700 px-2 py-1 hover:bg-gray-600"
                                    >
                                        {t('editor.status.rowPrev')}
                                    </button>
                                    <input
                                        type="number"
                                        min={0}
                                        value={rowIndex}
                                        onChange={(event) => jump(Number(event.target.value))}
                                        aria-label={t('editor.status.rowIndex')}
                                        className="w-16 rounded border border-gray-600 bg-gray-900 px-1 py-1 text-center"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => jump(rowIndex + 1)}
                                        className="rounded bg-gray-700 px-2 py-1 hover:bg-gray-600"
                                    >
                                        {t('editor.status.rowNext')}
                                    </button>
                                </div>
                            ) : (
                                <p className="text-xs italic text-gray-500">{t('editor.status.noCsv')}</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <ConnectionChip />
        </div>
    );
};

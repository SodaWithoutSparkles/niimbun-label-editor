import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { realZoom } from '../../core/viewport';
import { useSampleRowState } from './sampleRowContext';

/**
 * Editor status bar (ui-spec.md §9): zoom %, DPI, row-selector popup and the
 * read-only last-saved / auto-saved readouts (relocated from the gallery
 * BottomBar). The row selector is a non-modal popover (`role="dialog"` for
 * a11y); its Escape and click-outside handling are local and `stopPropagation`
 * so the global editor shortcuts do not also fire.
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
    const triggerRef = useRef<HTMLButtonElement>(null);
    const rowInputRef = useRef<HTMLInputElement>(null);

    const real = realZoom(screenDpi);
    // `effectiveZoom` is 0 until the Preview binds the real viewport. Rendering
    // a percent from that placeholder would flash "Zoom: 0%"; show "—" instead.
    const zoomPercent =
        real > 0 && effectiveZoom > 0 ? Math.round((effectiveZoom / real) * 100) : null;
    const rowIndex = doc?.data.sampleRowIndex ?? 0;
    const hasCsv = Boolean(doc?.data.csv);
    const rowCount = useSampleRowState()?.rowCount ?? 0;
    const lastIndex = Math.max(0, rowCount - 1);
    // 1-based draft for the popup input, so the input and the trigger label agree.
    const [rowDraft, setRowDraft] = useState(String(rowIndex + 1));

    // Save readouts (relocated from the gallery BottomBar). Read-only: the File
    // menu checkbox is the only auto-save toggle.
    const autoSave = useStore((state) => state.autoSave);
    const lastAutoSaveAt = useStore((state) => state.lastAutoSaveAt);
    const lastSavedAt = useStore((state) => state.lastSavedAt);
    const language = useStore((state) => state.language);

    // One formatter per language, reused across every call. `numeric: 'always'`
    // (the default) keeps the older "3 seconds ago" wording rather than the
    // "yesterday"/"now" that `numeric: 'auto'` would produce.
    //
    // Construction is defensive: even though the store validates `language`
    // against the supported allow-list on rehydration, a bad BCP-47 tag must
    // never blank the bar. If `Intl.RelativeTimeFormat` rejects the value, fall
    // back to English.
    const rtf = useMemo(() => {
        try {
            return new Intl.RelativeTimeFormat(language, { numeric: 'always' });
        } catch {
            return new Intl.RelativeTimeFormat('en', { numeric: 'always' });
        }
    }, [language]);

    // Pick the largest unit whose value is >= 1, mirroring the old ladder; the
    // ladder caps at days.
    const relative = (seconds: number): string => {
        if (seconds < 60) return rtf.format(-seconds, 'second');
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return rtf.format(-minutes, 'minute');
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return rtf.format(-hours, 'hour');
        const days = Math.floor(hours / 24);
        return rtf.format(-days, 'day');
    };

    // Keep time-sensitive statuses fresh by forcing a re-render every 10s when
    // nothing else changes.
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((n) => n + 1), 10000);
        return () => clearInterval(id);
    }, []);

    const getAutoSaveStatus = () => {
        if (!autoSave) return t('editor.status.autoSaveOff');
        if (!lastAutoSaveAt) return t('editor.status.autoSaveOn');
        const seconds = Math.floor((Date.now() - lastAutoSaveAt) / 1000);
        if (seconds < 5) return t('editor.status.autoSavedJustNow');
        return t('editor.status.autoSaved', { time: relative(seconds) });
    };

    const getLastSavedStatus = () => {
        if (!lastSavedAt) return t('editor.status.lastSavedNone');
        const seconds = Math.floor((Date.now() - lastSavedAt) / 1000);
        if (seconds < 5) return t('editor.status.lastSavedJustNow');
        return t('editor.status.lastSaved', { time: relative(seconds) });
    };

    // Keep the draft in step with the committed row (an external change while the
    // popup is open, or a prev/next step).
    useEffect(() => {
        if (rowOpen) setRowDraft(String(rowIndex + 1));
    }, [rowOpen, rowIndex]);

    // Move focus into the popup when it opens.
    useEffect(() => {
        if (!rowOpen) return;
        rowInputRef.current?.focus();
        rowInputRef.current?.select();
    }, [rowOpen]);

    useEffect(() => {
        if (!rowOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setRowOpen(false);
            triggerRef.current?.focus();
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

    /** Clamp a 0-based row into the attached table's range. */
    const clampIndex = (index: number): number => Math.min(lastIndex, Math.max(0, Math.round(index)));

    /** Commit a 0-based row, clamped so prev/next can never run off the table. */
    const jump = (index: number) => {
        const next = clampIndex(index);
        setRowDraft(String(next + 1));
        setSampleRowIndex(next);
    };

    /**
     * Commit the typed row on blur/Enter — one undo entry, not one per keystroke.
     * The input is 1-based (matching the trigger label); an unparseable value
     * reverts to the committed row.
     */
    const commitDraft = () => {
        const parsed = Number(rowDraft);
        if (!Number.isFinite(parsed)) {
            setRowDraft(String(rowIndex + 1));
            return;
        }
        const oneBased = Math.min(rowCount, Math.max(1, Math.round(parsed)));
        jump(oneBased - 1);
    };

    const triggerLabel = hasCsv
        ? rowCount > 0
            ? t('editor.status.rowOf', { index: rowIndex + 1, count: rowCount })
            : `${t('editor.status.row')}: ${rowIndex + 1}`
        : `${t('editor.status.row')}: —`;

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
                        ref={triggerRef}
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={rowOpen}
                        aria-controls="editor-row-popup"
                        onClick={() => setRowOpen((open) => !open)}
                        title={hasCsv ? t('editor.status.rowPopupTitle') : t('editor.status.noCsv')}
                        className="flex items-center gap-1 rounded border border-gray-600 bg-gray-800 px-2 py-0.5 transition-colors hover:bg-gray-700"
                    >
                        {triggerLabel}
                        <ChevronDown size={12} />
                    </button>
                    {rowOpen && (
                        <div
                            id="editor-row-popup"
                            role="dialog"
                            aria-label={t('editor.status.rowPopupTitle')}
                            className="absolute bottom-full left-0 z-40 mb-1 w-56 rounded border border-gray-600 bg-gray-800 p-2 shadow-xl"
                        >
                            {hasCsv && doc && rowCount > 0 ? (
                                <div className="flex items-center justify-between gap-2">
                                    <button
                                        type="button"
                                        onClick={() => jump(rowIndex - 1)}
                                        disabled={rowIndex <= 0}
                                        className="rounded bg-gray-700 px-2 py-1 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        {t('editor.status.rowPrev')}
                                    </button>
                                    <input
                                        ref={rowInputRef}
                                        type="number"
                                        min={1}
                                        max={rowCount}
                                        value={rowDraft}
                                        onChange={(event) => setRowDraft(event.target.value)}
                                        onBlur={commitDraft}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                commitDraft();
                                            }
                                        }}
                                        aria-label={t('editor.status.rowIndex')}
                                        className="w-16 rounded border border-gray-600 bg-gray-900 px-1 py-1 text-center"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => jump(rowIndex + 1)}
                                        disabled={rowIndex >= lastIndex}
                                        className="rounded bg-gray-700 px-2 py-1 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        {t('editor.status.rowNext')}
                                    </button>
                                </div>
                            ) : hasCsv ? (
                                <p className="text-xs italic text-gray-500">{t('editor.status.rowNoRows')}</p>
                            ) : (
                                <p className="text-xs italic text-gray-500">{t('editor.status.noCsv')}</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className="rounded border border-gray-600 bg-gray-800 px-2 py-0.5">{getAutoSaveStatus()}</span>
                <span className={cn('rounded border px-2 py-0.5', lastSavedAt ? 'border-blue-700 bg-blue-900/40 text-blue-300' : 'border-purple-700 bg-purple-900/40 text-purple-300')}>{getLastSavedStatus()}</span>
            </div>
        </div>
    );
};

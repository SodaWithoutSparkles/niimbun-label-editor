import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import { formatKey } from '../../utils/formatKey';
import { toolLabel } from './toolLabels';

export const BottomBar: React.FC = () => {
    const { t } = useTranslation();
    const activeTool = useStore((state) => state.activeTool);
    const autoSave = useStore((state) => state.autoSave);
    const toggleAutoSave = useStore((state) => state.toggleAutoSave);
    const lastAutoSaveAt = useStore((state) => state.lastAutoSaveAt);
    const lastSavedAt = useStore((state) => state.lastSavedAt);
    const keyboardShortcuts = useStore((state) => state.keyboardShortcuts);
    const language = useStore((state) => state.language);
    const view = useStore((state) => state.view);
    const setView = useStore((state) => state.setView);
    const printerStatus = useStore((state) => state.printerStatus);
    const printerConnected = printerStatus.state === 'connected' || printerStatus.state === 'printing';

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

    // Pick the largest unit whose value is >= 1, mirroring the old ladder.
    // `maxUnit` caps the tier. Every caller uses `'day'` so the compact and full
    // layouts cannot disagree (e.g. "180 minutes ago" vs "3 hours ago") for the
    // same fact.
    const relative = (seconds: number, maxUnit: 'minute' | 'day'): string => {
        if (seconds < 60) return rtf.format(-seconds, 'second');
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60 || maxUnit === 'minute') return rtf.format(-minutes, 'minute');
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return rtf.format(-hours, 'hour');
        const days = Math.floor(hours / 24);
        return rtf.format(-days, 'day');
    };

    // Keep time-sensitive statuses fresh by forcing a re-render every 10s when nothing else changes.
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick((n) => n + 1), 10000);
        return () => clearInterval(id);
    }, []);

    const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const isCompact = viewportWidth < 1100;

    const modifierKeyLabel = formatKey(keyboardShortcuts.modifyKey, t);

    const getAutoSaveStatus = () => {
        if (!autoSave) return t('bottomBar.autoSaveOff');
        if (!lastAutoSaveAt) return t('bottomBar.autoSaveOn');
        const seconds = Math.floor((Date.now() - lastAutoSaveAt) / 1000);
        if (seconds < 5) return t('bottomBar.autoSavedJustNow');
        return t('bottomBar.autoSaved', { time: relative(seconds, 'day') });
    };

    const getLastSavedStatus = () => {
        if (!lastSavedAt) return t('bottomBar.lastSavedNone');
        const seconds = Math.floor((Date.now() - lastSavedAt) / 1000);
        if (seconds < 5) return t('bottomBar.lastSavedJustNow');
        return t('bottomBar.lastSaved', { time: relative(seconds, 'day') });
    };

    const getAutoSaveCompactStatus = () => {
        if (!autoSave) return t('bottomBar.autoSaveShortOff');
        if (!lastAutoSaveAt) return t('bottomBar.autoSaveShortOn');
        const seconds = Math.floor((Date.now() - lastAutoSaveAt) / 1000);
        if (seconds < 5) return t('bottomBar.shortJustNow');
        return t('bottomBar.autoSavedShort', { time: relative(seconds, 'day') });
    };

    const getLastSavedCompactStatus = () => {
        if (!lastSavedAt) return t('bottomBar.lastSavedNotSaved');
        const seconds = Math.floor((Date.now() - lastSavedAt) / 1000);
        if (seconds < 5) return t('bottomBar.shortJustNow');
        return t('bottomBar.lastSavedShort', { time: relative(seconds, 'day') });
    };

    const renderInstruction = () => {
        if (isCompact) return null;
        if (activeTool === 'select') {
            return t('toolHints.select', { modifier: modifierKeyLabel });
        }
        if (activeTool === 'shape:rectangle') {
            return t('toolHints.rectangle', { modifier: modifierKeyLabel });
        }
        if (activeTool === 'shape:ellipse') {
            return t('toolHints.ellipse', { modifier: modifierKeyLabel });
        }
        if (activeTool === 'shape:line') {
            return t('toolHints.line', { modifier: modifierKeyLabel });
        }

        return null;
    };

    const instructionText = renderInstruction();

    return (
        <div className="h-8 bg-gray-900 border-t border-gray-700 flex items-center justify-between px-3 text-xs text-gray-300 select-none z-30">
            <div className="flex items-center space-x-2">
                {/* Duplicate of the top-right connection chip: bottom-left, same status. */}
                <div
                    role="status"
                    aria-label={t('connection.statusAria')}
                    className={clsx(
                        "flex items-center space-x-1.5 px-2 py-0.5 rounded border",
                        printerConnected
                            ? "border-emerald-700 bg-emerald-900/40 text-emerald-100"
                            : "border-gray-600 bg-gray-800 text-gray-400"
                    )}
                    title={printerConnected ? t('connection.connected') : t('connection.disconnected')}
                >
                    <span className={clsx("h-2 w-2 rounded-full", printerConnected ? "bg-emerald-400" : "bg-gray-500")} />
                    {!isCompact && (
                        <span>{printerConnected ? t('connection.connected') : t('connection.disconnected')}</span>
                    )}
                </div>

                <div className="px-2 py-0.5 rounded border border-emerald-700 bg-emerald-900/40 text-emerald-100">
                    {isCompact ? (
                        <span className="font-medium">{toolLabel(activeTool, t)}</span>
                    ) : (
                        <>
                            {t('bottomBar.tool')} <span className="text-white font-medium">{toolLabel(activeTool, t)}</span>
                        </>
                    )}
                </div>

                <button
                    onClick={toggleAutoSave}
                    className={clsx(
                        "px-2 py-0.5 rounded border transition-colors",
                        autoSave
                            ? "border-green-700 bg-green-900/40 text-green-300"
                            : "border-orange-700 bg-orange-900/40 text-orange-300"
                    )}
                    title={t('bottomBar.toggleAutoSave')}
                >
                    {isCompact ? getAutoSaveCompactStatus() : getAutoSaveStatus()}
                </button>

                <div
                    className={clsx(
                        "px-2 py-0.5 rounded border",
                        lastSavedAt ? "border-blue-700 bg-blue-900/40 text-blue-300" : "border-purple-700 bg-purple-900/40 text-purple-300"
                    )}
                >
                    {isCompact ? getLastSavedCompactStatus() : getLastSavedStatus()}
                </div>

                {instructionText && (
                    <div className="px-2 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-slate-200">
                        {instructionText}
                    </div>
                )}
            </div>

            <div className="flex items-center space-x-2 h-full py-1">
                {view === 'editor' && (
                    <button
                        onClick={() => setView('gallery')}
                        className="px-3 h-full flex items-center rounded transition-colors space-x-2 bg-gray-800 hover:bg-gray-700 text-gray-300"
                        title={t('nav.backToGalleryTitle')}
                    >
                        <ArrowLeft size={14} />
                        {!isCompact && <span>{t('nav.backToGallery')}</span>}
                    </button>
                )}
            </div>
        </div>
    );
};

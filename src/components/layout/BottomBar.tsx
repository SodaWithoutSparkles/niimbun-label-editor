import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { Home } from 'lucide-react';
import clsx from 'clsx';

export const BottomBar: React.FC = () => {
    const { t } = useTranslation();
    const activeTool = useStore((state) => state.activeTool);
    const autoSave = useStore((state) => state.autoSave);
    const toggleAutoSave = useStore((state) => state.toggleAutoSave);
    const lastAutoSaveAt = useStore((state) => state.lastAutoSaveAt);
    const lastSavedAt = useStore((state) => state.lastSavedAt);
    const keyboardShortcuts = useStore((state) => state.keyboardShortcuts);
    const canvasPosition = useStore((state) => state.canvasPosition);
    const triggerHomeView = useStore((state) => state.triggerHomeView);

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

    const formatKey = (key: string) => {
        if (!key) return '';
        if (key.toLowerCase() === 'ctrl') return t('keyLabels.ctrl');
        if (key.toLowerCase() === 'alt') return t('keyLabels.alt');
        if (key.toLowerCase() === 'shift') return t('keyLabels.shift');
        if (key.toLowerCase() === 'escape') return t('keyLabels.esc');
        if (key.toLowerCase() === ' ') return t('keyLabels.space');
        return key.length === 1 ? key.toUpperCase() : key;
    };

    const modifierKeyLabel = formatKey(keyboardShortcuts.modifyKey);

    const getAutoSaveStatus = () => {
        if (!autoSave) return t('bottomBar.autoSaveOff');
        if (!lastAutoSaveAt) return t('bottomBar.autoSaveOn');
        const seconds = Math.floor((Date.now() - lastAutoSaveAt) / 1000);
        if (seconds < 5) return t('bottomBar.autoSavedJustNow');
        if (seconds < 60) return t('bottomBar.autoSavedSecondsAgo', { count: seconds });
        const minutes = Math.floor(seconds / 60);
        return t('bottomBar.autoSavedMinutesAgo', { count: minutes });
    };

    const getLastSavedStatus = () => {
        if (!lastSavedAt) return t('bottomBar.lastSavedNone');
        const seconds = Math.floor((Date.now() - lastSavedAt) / 1000);
        if (seconds < 5) return t('bottomBar.lastSavedJustNow');
        if (seconds < 60) return t('bottomBar.lastSavedSecondsAgo', { count: seconds });
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return t('bottomBar.lastSavedMinutesAgo', { count: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t('bottomBar.lastSavedHoursAgo', { count: hours });
        const days = Math.floor(hours / 24);
        return t('bottomBar.lastSavedDaysAgo', { count: days });
    };

    const getAutoSaveCompactStatus = () => {
        if (!autoSave) return t('bottomBar.autoSaveShortOff');
        if (!lastAutoSaveAt) return t('bottomBar.autoSaveShortOn');
        const seconds = Math.floor((Date.now() - lastAutoSaveAt) / 1000);
        if (seconds < 5) return t('bottomBar.shortJustNow');
        if (seconds < 60) return t('bottomBar.shortSecondsAgo', { count: seconds });
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return t('bottomBar.shortMinutesAgo', { count: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t('bottomBar.shortHoursAgo', { count: hours });
        const days = Math.floor(hours / 24);
        return t('bottomBar.shortDaysAgo', { count: days });
    };

    const getLastSavedCompactStatus = () => {
        if (!lastSavedAt) return t('bottomBar.lastSavedNotSaved');
        const seconds = Math.floor((Date.now() - lastSavedAt) / 1000);
        if (seconds < 5) return t('bottomBar.shortJustNow');
        if (seconds < 60) return t('bottomBar.shortSecondsAgo', { count: seconds });
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return t('bottomBar.shortMinutesAgo', { count: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t('bottomBar.shortHoursAgo', { count: hours });
        const days = Math.floor(hours / 24);
        return t('bottomBar.shortDaysAgo', { count: days });
    };

    const renderInstruction = () => {
        if (isCompact) return null;
        if (activeTool === 'select') {
            return t('toolHints.select', { modifier: modifierKeyLabel });
        }
        if (activeTool === 'rectangle') {
            return t('toolHints.rectangle', { modifier: modifierKeyLabel });
        }
        if (activeTool === 'ellipse') {
            return t('toolHints.ellipse', { modifier: modifierKeyLabel });
        }
        if (activeTool === 'callout') {
            return t('toolHints.callout', { modifier: modifierKeyLabel });
        }
        if (activeTool === 'line') {
            return t('toolHints.line', { modifier: modifierKeyLabel });
        }
        if (activeTool === 'arrow') {
            return t('toolHints.arrow', { modifier: modifierKeyLabel });
        }

        return null;
    };

    const instructionText = renderInstruction();

    return (
        <div className="h-8 bg-gray-900 border-t border-gray-700 flex items-center justify-between px-3 text-xs text-gray-300 select-none z-30">
            <div className="flex items-center space-x-2">
                <div className="px-2 py-0.5 rounded border border-emerald-700 bg-emerald-900/40 text-emerald-100">
                    {isCompact ? (
                        <span className="font-medium capitalize">{activeTool}</span>
                    ) : (
                        <>
                            {t('bottomBar.tool')} <span className="text-white font-medium capitalize">{activeTool}</span>
                        </>
                    )}
                </div>

                <div className="px-2 py-0.5 rounded border border-amber-700 bg-amber-900/40 text-amber-100">
                    {isCompact ? (
                        <span>
                            {t('bottomBar.coords', { x: Math.round(canvasPosition.x), y: Math.round(canvasPosition.y), scale: Math.round(canvasPosition.scale * 100) })}
                        </span>
                    ) : (
                        <>
                            {t('bottomBar.zoom')} <span className="text-white font-medium">{Math.round(canvasPosition.scale * 100)}%</span>
                            <span className="ml-2">
                                {t('bottomBar.x')} <span className="text-white font-medium">{Math.round(canvasPosition.x)}</span>
                                {' '}{t('bottomBar.y')} <span className="text-white font-medium">{Math.round(canvasPosition.y)}</span>
                            </span>
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
                <button
                    onClick={triggerHomeView}
                    className="px-3 h-full flex items-center rounded transition-colors space-x-2 bg-gray-800 hover:bg-gray-700 text-gray-300"
                    title={t('bottomBar.resetView')}
                >
                    <Home size={14} />
                    {!isCompact && <span>{t('bottomBar.home')}</span>}
                </button>
            </div>
        </div>
    );
};

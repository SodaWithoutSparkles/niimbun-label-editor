import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import { Home } from 'lucide-react';
import clsx from 'clsx';

export const BottomBar: React.FC = () => {
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
        const id = setInterval(() => setTick((t) => t + 1), 10000);
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
        if (key.toLowerCase() === 'ctrl') return 'Ctrl';
        if (key.toLowerCase() === 'alt') return 'Alt';
        if (key.toLowerCase() === 'shift') return 'Shift';
        if (key.toLowerCase() === 'escape') return 'Esc';
        if (key.toLowerCase() === ' ') return 'Space';
        return key.length === 1 ? key.toUpperCase() : key;
    };

    const modifierKeyLabel = formatKey(keyboardShortcuts.modifyKey);

    const getAutoSaveStatus = () => {
        if (!autoSave) return 'Auto-save off';
        if (!lastAutoSaveAt) return 'Auto-save on';
        const seconds = Math.floor((Date.now() - lastAutoSaveAt) / 1000);
        if (seconds < 5) return 'Auto-saved just now';
        if (seconds < 60) return `Auto-saved ${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        return `Auto-saved ${minutes}m ago`;
    };

    const getLastSavedStatus = () => {
        if (!lastSavedAt) return 'Last saved: —';
        const seconds = Math.floor((Date.now() - lastSavedAt) / 1000);
        if (seconds < 5) return 'Last saved: just now';
        if (seconds < 60) return `Last saved: ${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `Last saved: ${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `Last saved: ${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `Last saved: ${days}d ago`;
    };

    const getAutoSaveCompactStatus = () => {
        if (!autoSave) return 'Off';
        if (!lastAutoSaveAt) return 'On';
        const seconds = Math.floor((Date.now() - lastAutoSaveAt) / 1000);
        if (seconds < 5) return 'Just now';
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    const getLastSavedCompactStatus = () => {
        if (!lastSavedAt) return 'Not saved';
        const seconds = Math.floor((Date.now() - lastSavedAt) / 1000);
        if (seconds < 5) return 'Just now';
        if (seconds < 60) return `${seconds}s ago`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    };

    const renderInstruction = () => {
        if (isCompact) return null;
        if (activeTool === 'select') {
            return `Select: ${modifierKeyLabel} to multi-sel, drag to move`;
        }
        if (activeTool === 'rectangle') {
            return `Rectangle: ${modifierKeyLabel} to square`;
        }
        if (activeTool === 'ellipse') {
            return `Ellipse: ${modifierKeyLabel} to circle`;
        }
        if (activeTool === 'callout') {
            return `Callout: Space to start arrow; ${modifierKeyLabel} to straight arrow`;
        }
        if (activeTool === 'line') {
            return `Line: ${modifierKeyLabel} to straight line`;
        }
        if (activeTool === 'arrow') {
            return `Arrow: Space to start arrow, ${modifierKeyLabel} to straight arrow`;
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
                            Tool: <span className="text-white font-medium capitalize">{activeTool}</span>
                        </>
                    )}
                </div>

                <div className="px-2 py-0.5 rounded border border-amber-700 bg-amber-900/40 text-amber-100">
                    {isCompact ? (
                        <span>
                            ({Math.round(canvasPosition.x)}, {Math.round(canvasPosition.y)}, {Math.round(canvasPosition.scale * 100)}%)
                        </span>
                    ) : (
                        <>
                            Zoom: <span className="text-white font-medium">{Math.round(canvasPosition.scale * 100)}%</span>
                            <span className="ml-2">
                                X: <span className="text-white font-medium">{Math.round(canvasPosition.x)}</span>
                                {' '}Y: <span className="text-white font-medium">{Math.round(canvasPosition.y)}</span>
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
                    title="Toggle auto-save"
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
                    title="Reset view to center"
                >
                    <Home size={14} />
                    {!isCompact && <span>Home</span>}
                </button>
            </div>
        </div>
    );
};

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { X } from 'lucide-react';
import { ColorPicker } from './ColorPicker';
import { TOOL_LABEL_KEYS } from '../layout/toolLabels';

export const ToolSettingsModal: React.FC = () => {
    const { t } = useTranslation();
    const showToolSettings = useStore((state) => state.showToolSettings);
    const setShowToolSettings = useStore((state) => state.setShowToolSettings);
    const activeTool = useStore((state) => state.activeTool);
    const toolSettings = useStore((state) => state.toolSettings);
    const setToolSettings = useStore((state) => state.setToolSettings);
    const modalRef = useRef<HTMLDivElement>(null);
    const [offsetY, setOffsetY] = useState(0);

    useEffect(() => {
        // Removed click outside listener to make it non-blocking/modeless
    }, [showToolSettings, setShowToolSettings]);

    useEffect(() => {
        if (!showToolSettings) return;

        const updatePosition = () => {
            if (!modalRef.current) return;
            const rect = modalRef.current.getBoundingClientRect();
            const padding = 8;
            let nextOffset = 0;

            if (rect.bottom > window.innerHeight - padding) {
                nextOffset = (window.innerHeight - padding) - rect.bottom;
            }

            if (rect.top + nextOffset < padding) {
                nextOffset += padding - (rect.top + nextOffset);
            }

            setOffsetY(nextOffset);
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        return () => window.removeEventListener('resize', updatePosition);
    }, [showToolSettings, activeTool, toolSettings]);

    if (!showToolSettings) return null;

    const isTextTool = activeTool === 'text' || activeTool === 'callout';
    const isShapeTool = ['rectangle', 'ellipse', 'line', 'arrow', 'star', 'callout'].includes(activeTool);

    return (
        <div
            ref={modalRef}
            className="absolute left-full top-0 ml-4 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-4 min-w-[320px] max-w-[380px] z-50 pointer-events-auto"
            style={{ transform: `translateY(${offsetY}px)` }}
        >
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-100 capitalize">
                    {t('toolSettings.title', { tool: t(TOOL_LABEL_KEYS[activeTool]) })}
                </h2>
                <button
                    onClick={() => setShowToolSettings(false)}
                    className="text-gray-400 hover:text-gray-200 transition-colors"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="space-y-4">
                {/* Line Width for shape tools */}
                {isShapeTool && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="text-sm text-gray-300">{t('toolSettings.lineWidth')}</label>
                            <span className="text-xs text-gray-400">{toolSettings.lineWidth}px</span>
                        </div>
                        <input
                            type="range"
                            min="1"
                            max="20"
                            step="1"
                            value={toolSettings.lineWidth}
                            onChange={(e) =>
                                setToolSettings({ lineWidth: parseInt(e.target.value) })
                            }
                            className="w-full"
                        />
                    </div>
                )}

                {/* Font settings for text tool */}
                {isTextTool && (
                    <>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm text-gray-300">{t('toolSettings.fontSize')}</label>
                                <span className="text-xs text-gray-400">{toolSettings.fontSize}px</span>
                            </div>
                            <input
                                type="range"
                                min="8"
                                max="72"
                                step="1"
                                value={toolSettings.fontSize}
                                onChange={(e) =>
                                    setToolSettings({ fontSize: parseInt(e.target.value) })
                                }
                                className="w-full"
                            />
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <label className="text-sm text-gray-300">{t('toolSettings.fontFamily')}</label>
                            <select
                                value={toolSettings.fontFamily}
                                onChange={(e) => setToolSettings({ fontFamily: e.target.value })}
                                className="w-44 px-3 py-2 bg-gray-700 text-gray-300 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                            >
                                <option value="Arial">{t('toolSettings.fontFamilyOptions.arial')}</option>
                                <option value="Times New Roman">{t('toolSettings.fontFamilyOptions.timesNewRoman')}</option>
                                <option value="Courier New">{t('toolSettings.fontFamilyOptions.courierNew')}</option>
                                <option value="Georgia">{t('toolSettings.fontFamilyOptions.georgia')}</option>
                                <option value="Verdana">{t('toolSettings.fontFamilyOptions.verdana')}</option>
                                <option value="Comic Sans MS">{t('toolSettings.fontFamilyOptions.comicSansMs')}</option>
                            </select>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <label className="text-sm text-gray-300">{t('toolSettings.fontWeight')}</label>
                            <select
                                value={toolSettings.fontWeight}
                                onChange={(e) => setToolSettings({ fontWeight: e.target.value as 'normal' | 'bold' })}
                                className="w-44 px-3 py-2 bg-gray-700 text-gray-300 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                            >
                                <option value="normal">{t('toolSettings.fontWeightOptions.normal')}</option>
                                <option value="bold">{t('toolSettings.fontWeightOptions.bold')}</option>
                            </select>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <label className="text-sm text-gray-300">{t('toolSettings.fontStyle')}</label>
                            <select
                                value={toolSettings.fontStyle}
                                onChange={(e) => setToolSettings({ fontStyle: e.target.value as 'normal' | 'italic' })}
                                className="w-44 px-3 py-2 bg-gray-700 text-gray-300 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                            >
                                <option value="normal">{t('toolSettings.fontStyleOptions.normal')}</option>
                                <option value="italic">{t('toolSettings.fontStyleOptions.italic')}</option>
                            </select>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <label className="text-sm text-gray-300">{t('toolSettings.textAlign')}</label>
                            <select
                                value={toolSettings.textAlign}
                                onChange={(e) => setToolSettings({ textAlign: e.target.value as 'left' | 'center' | 'right' })}
                                className="w-44 px-3 py-2 bg-gray-700 text-gray-300 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                            >
                                <option value="left">{t('toolSettings.textAlignOptions.left')}</option>
                                <option value="center">{t('toolSettings.textAlignOptions.center')}</option>
                                <option value="right">{t('toolSettings.textAlignOptions.right')}</option>
                            </select>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <label className="text-sm text-gray-300">{t('toolSettings.textColor')}</label>
                            <div className="flex items-center space-x-3">
                                <ColorPicker
                                    color={toolSettings.textColor}
                                    onChange={(color) => setToolSettings({ textColor: color })}
                                />
                                <span className="text-xs text-gray-400">{toolSettings.textColor.toUpperCase()}</span>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

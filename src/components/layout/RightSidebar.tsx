import React from 'react';
import { useStore } from '../../store/useStore';
import { Layers, History, Sliders, Trash2 } from 'lucide-react';
import { ColorPicker } from '../common/ColorPicker';

export const RightSidebar: React.FC = () => {
    const history = useStore((state) => state.history);
    const historyUndoCount = useStore((state) => state.historyUndoCount);
    const objects = useStore((state) => state.objects);
    const selectedIds = useStore((state) => state.selectedIds);
    const selectItem = useStore((state) => state.selectItem);
    const toggleSelectItem = useStore((state) => state.toggleSelectItem);
    const updateItem = useStore((state) => state.updateItem);
    const updateItems = useStore((state) => state.updateItems);
    const colors = useStore((state) => state.colors);
    const deleteAllItems = useStore((state) => state.deleteAllItems);

    const hasSelection = selectedIds.length > 0;
    const isMultiSelect = selectedIds.length > 1;
    const selectedItem = hasSelection ? objects.find((item) => item.id === selectedIds[0]) : null;

    const updateSelected = (updates: Parameters<typeof updateItem>[1]) => {
        if (selectedIds.length === 1 && selectedItem) {
            updateItem(selectedItem.id, updates);
            return;
        }
        if (selectedIds.length > 1) {
            updateItems(selectedIds, updates);
        }
    };

    const parseNumber = (value: string, fallback = 0) => {
        const parsed = parseFloat(value);
        return Number.isNaN(parsed) ? fallback : parsed;
    };

    return (
        <div className="w-64 bg-gray-800 border-l border-gray-700 flex flex-col text-gray-300 z-20">
            {/* Top Half: Object Settings OR History */}
            <div className="flex-1 flex flex-col border-b border-gray-700 min-h-0">
                <div className="bg-gray-900 px-3 py-1 text-xs font-semibold uppercase tracking-wider flex items-center">
                    {hasSelection ? (
                        <><Sliders size={12} className="mr-2" /> Object Settings</>
                    ) : (
                        <><History size={12} className="mr-2" /> History</>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-2">
                    {hasSelection && selectedItem ? (
                        <div className="space-y-4 text-sm">
                            <div className="text-xs text-gray-400">
                                {selectedIds.length > 1 ? `${selectedIds.length} selected` : selectedItem.type}
                            </div>

                            {isMultiSelect ? (
                                <>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs text-gray-400">Primary</span>
                                        <ColorPicker
                                            color={colors.stroke}
                                            onChange={(color) => updateSelected({ stroke: color })}
                                            menuAlign="right"
                                        />
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs text-gray-400">Secondary</span>
                                        <ColorPicker
                                            color={colors.fill}
                                            onChange={(color) => updateSelected({ fill: color })}
                                            supportsAlpha
                                            menuAlign="right"
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 gap-3">
                                        <label className="flex flex-col gap-1">
                                            <span className="text-xs text-gray-400">X</span>
                                            <input
                                                type="number"
                                                value={selectedItem.x}
                                                onChange={(e) => updateSelected({ x: parseNumber(e.target.value, selectedItem.x) })}
                                                className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-xs text-gray-400">Y</span>
                                            <input
                                                type="number"
                                                value={selectedItem.y}
                                                onChange={(e) => updateSelected({ y: parseNumber(e.target.value, selectedItem.y) })}
                                                className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-xs text-gray-400">Rotation</span>
                                            <input
                                                type="number"
                                                value={selectedItem.rotation}
                                                onChange={(e) => updateSelected({ rotation: parseNumber(e.target.value, selectedItem.rotation) })}
                                                className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-xs text-gray-400">Opacity</span>
                                            <input
                                                type="number"
                                                min="0"
                                                max="1"
                                                step="0.05"
                                                value={selectedItem.opacity}
                                                onChange={(e) => updateSelected({ opacity: parseNumber(e.target.value, selectedItem.opacity) })}
                                                className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                            />
                                        </label>
                                    </div>

                                    {'strokeWidth' in selectedItem && (
                                        <label className="flex flex-col gap-1">
                                            <span className="text-xs text-gray-400">Stroke Width</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={selectedItem.strokeWidth}
                                                onChange={(e) => updateSelected({ strokeWidth: parseNumber(e.target.value, selectedItem.strokeWidth) })}
                                                className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                            />
                                        </label>
                                    )}

                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs text-gray-400">Stroke</span>
                                        <ColorPicker
                                            color={selectedItem.stroke}
                                            onChange={(color) => updateSelected({ stroke: color })}
                                            menuAlign="right"
                                        />
                                    </div>

                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs text-gray-400">Fill</span>
                                        <ColorPicker
                                            color={selectedItem.fill}
                                            onChange={(color) => updateSelected({ fill: color })}
                                            supportsAlpha
                                            menuAlign="right"
                                        />
                                    </div>

                                    {(selectedItem.type === 'rectangle' || selectedItem.type === 'image' || selectedItem.type === 'text') && (
                                        <div className="grid grid-cols-2 gap-3">
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Width</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={selectedItem.width}
                                                    onChange={(e) => updateSelected({ width: parseNumber(e.target.value, selectedItem.width) })}
                                                    className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Height</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={selectedItem.height}
                                                    onChange={(e) => updateSelected({ height: parseNumber(e.target.value, selectedItem.height) })}
                                                    className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                />
                                            </label>
                                        </div>
                                    )}

                                    {selectedItem.type === 'ellipse' && (
                                        <div className="grid grid-cols-2 gap-3">
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Radius X</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={selectedItem.radiusX}
                                                    onChange={(e) => updateSelected({ radiusX: parseNumber(e.target.value, selectedItem.radiusX) })}
                                                    className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Radius Y</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={selectedItem.radiusY}
                                                    onChange={(e) => updateSelected({ radiusY: parseNumber(e.target.value, selectedItem.radiusY) })}
                                                    className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                />
                                            </label>
                                        </div>
                                    )}

                                    {selectedItem.type === 'star' && (
                                        <div className="grid grid-cols-2 gap-3">
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Inner Radius</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={selectedItem.innerRadius}
                                                    onChange={(e) => updateSelected({ innerRadius: parseNumber(e.target.value, selectedItem.innerRadius) })}
                                                    className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Outer Radius</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={selectedItem.outerRadius}
                                                    onChange={(e) => updateSelected({ outerRadius: parseNumber(e.target.value, selectedItem.outerRadius) })}
                                                    className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                />
                                            </label>
                                        </div>
                                    )}

                                    {selectedItem.type === 'arrow' && (
                                        <div className="grid grid-cols-2 gap-3">
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Pointer Length</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={selectedItem.pointerLength}
                                                    onChange={(e) => updateSelected({ pointerLength: parseNumber(e.target.value, selectedItem.pointerLength) })}
                                                    className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                />
                                            </label>
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Pointer Width</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={selectedItem.pointerWidth}
                                                    onChange={(e) => updateSelected({ pointerWidth: parseNumber(e.target.value, selectedItem.pointerWidth) })}
                                                    className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                />
                                            </label>
                                        </div>
                                    )}

                                    {selectedItem.type === 'text' && (
                                        <div className="space-y-3">
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Text</span>
                                                <textarea
                                                    value={selectedItem.text}
                                                    onChange={(e) => updateSelected({ text: e.target.value })}
                                                    className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                    rows={3}
                                                />
                                            </label>
                                            <div className="grid grid-cols-2 gap-3">
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-xs text-gray-400">Font Size</span>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={selectedItem.fontSize}
                                                        onChange={(e) => updateSelected({ fontSize: parseNumber(e.target.value, selectedItem.fontSize) })}
                                                        className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                    />
                                                </label>
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-xs text-gray-400">Font Family</span>
                                                    <input
                                                        type="text"
                                                        value={selectedItem.fontFamily}
                                                        onChange={(e) => updateSelected({ fontFamily: e.target.value })}
                                                        className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                    />
                                                </label>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-xs text-gray-400">Font Weight</span>
                                                    <select
                                                        value={selectedItem.fontWeight ?? 'normal'}
                                                        onChange={(e) => updateSelected({ fontWeight: e.target.value as 'normal' | 'bold' })}
                                                        className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                    >
                                                        <option value="normal">Normal</option>
                                                        <option value="bold">Bold</option>
                                                    </select>
                                                </label>
                                                <label className="flex flex-col gap-1">
                                                    <span className="text-xs text-gray-400">Font Style</span>
                                                    <select
                                                        value={selectedItem.fontStyle ?? 'normal'}
                                                        onChange={(e) => updateSelected({ fontStyle: e.target.value as 'normal' | 'italic' })}
                                                        className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                    >
                                                        <option value="normal">Normal</option>
                                                        <option value="italic">Italic</option>
                                                    </select>
                                                </label>
                                            </div>
                                            <label className="flex flex-col gap-1">
                                                <span className="text-xs text-gray-400">Text Align</span>
                                                <select
                                                    value={selectedItem.align}
                                                    onChange={(e) => updateSelected({ align: e.target.value as 'left' | 'center' | 'right' })}
                                                    className="w-full px-2 py-1 rounded bg-gray-700 border border-gray-600 focus:border-blue-500 focus:outline-none"
                                                >
                                                    <option value="left">Left</option>
                                                    <option value="center">Center</option>
                                                    <option value="right">Right</option>
                                                </select>
                                            </label>
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-xs text-gray-400">Text Color</span>
                                                <ColorPicker
                                                    color={selectedItem.textColor ?? selectedItem.stroke}
                                                    onChange={(color) => updateSelected({ textColor: color })}
                                                    menuAlign="right"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    ) : (
                        <ul className="space-y-1">
                            {history.map((action, i) => {
                                const isShadowDeleted = i < historyUndoCount;
                                return (
                                    <li
                                        key={i}
                                        className={`text-sm px-2 py-1 rounded cursor-pointer truncate ${isShadowDeleted ? 'text-gray-500 line-through' : 'hover:bg-gray-700'}`}
                                        title={isShadowDeleted ? 'Undone' : undefined}
                                    >
                                        {action}
                                    </li>
                                );
                            })}
                            {history.length === 0 && <li className="text-gray-500 italic text-xs p-2">No history</li>}
                        </ul>
                    )}
                </div>
            </div>

            {/* Bottom Half: Objects / Layers */}
            <div className="flex-1 flex flex-col min-h-0 bg-gray-800">
                <div className="bg-gray-900 px-3 py-1 text-xs font-semibold uppercase tracking-wider flex items-center justify-between">
                    <div className="flex items-center">
                        <Layers size={12} className="mr-2" /> Objects
                    </div>
                    {objects.length > 0 && (
                        <button
                            type="button"
                            aria-label="Clear All Objects"
                            title="Clear All Objects"
                            onClick={() => {
                                if (window.confirm("WARNING: This will delete ALL objects on the canvas.\n\nAre you sure you want to clear everything?")) {
                                    deleteAllItems();
                                }
                            }}
                            className="p-1 rounded hover:bg-red-900/50 text-gray-400 hover:text-red-400 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-red-500"
                        >
                            <Trash2 size={12} />
                        </button>
                    )}
                </div>
                <div className="flex-1 overflow-y-auto p-2">
                    <ul className="space-y-1">
                        {/* Render Objects in Reverse order (Top on list = Top z-index usually, or logic can vary) */}
                        {[...objects].reverse().map((item, i) => (
                            <li
                                key={item.id}
                                className={`text-sm px-2 py-1 rounded cursor-pointer flex items-center ${selectedIds.includes(item.id) ? 'bg-blue-900 text-white' : 'hover:bg-gray-700'}`}
                                onClick={(e) => {
                                    if (e.ctrlKey) {
                                        toggleSelectItem(item.id);
                                        return;
                                    }
                                    if (selectedIds.includes(item.id)) {
                                        toggleSelectItem(item.id);
                                        return;
                                    }
                                    selectItem(item.id);
                                }}
                            >
                                <span className="opacity-50 mr-2 text-xs">#{objects.length - 1 - i}</span>
                                <span className="capitalize">{item.type}</span>
                            </li>
                        ))}
                        {objects.length === 0 && <li className="text-gray-500 italic text-xs p-2">No objects</li>}
                    </ul>
                </div>
            </div>
        </div>
    );
};

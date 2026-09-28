import React, { useState, useRef, useEffect } from 'react';
import { Pipette, Plus } from 'lucide-react';
import { useStore } from '../../store/useStore';

const clampAlpha = (value: number) => Math.max(0, Math.min(1, value));

const formatHexWithAlpha = (hex: string, alpha: number) => {
    const a = Math.round(clampAlpha(alpha) * 255)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
    return `${hex.toUpperCase()}${a}`;
};

const parseColorString = (value: string) => {
    if (value === 'transparent') {
        return { hex: '#000000', alpha: 0 };
    }

    if (value.startsWith('#')) {
        let hex = value.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            hex = hex
                .split('')
                .map((c) => c + c)
                .join('');
        }

        if (hex.length === 6) {
            return { hex: `#${hex}`, alpha: 1 };
        }

        if (hex.length === 8) {
            const base = `#${hex.slice(0, 6)}`;
            const alpha = parseInt(hex.slice(6, 8), 16) / 255;
            return { hex: base, alpha: clampAlpha(alpha) };
        }
    }

    if (value.startsWith('rgb')) {
        const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            const [, r, g, b, a] = match;
            const hex = `#${parseInt(r, 10).toString(16).padStart(2, '0')}${parseInt(g, 10).toString(16).padStart(2, '0')}${parseInt(b, 10).toString(16).padStart(2, '0')}`;
            return { hex, alpha: clampAlpha(parseFloat(a ?? '1')) };
        }
    }

    return { hex: '#000000', alpha: 1 };
};

interface DualColorPickerProps {
    strokeColor: string;
    fillColor: string;
    activeType?: 'stroke' | 'fill';
    onColorChange: (type: 'stroke' | 'fill', color: string) => void;
    onActiveTypeChange: (type: 'stroke' | 'fill') => void;
    onPick: () => void;
}

interface ColorSectionProps {
    label: string;
    color: string;
    onChange: (color: string) => void;
    onPick: () => void;
    supportsAlpha?: boolean;
}

const ColorSection: React.FC<ColorSectionProps> = ({
    label,
    color,
    onChange,
    onPick,
    supportsAlpha = false
}) => {
    const initial = parseColorString(color);
    const [localColor, setLocalColor] = useState(initial.hex);
    const [alpha, setAlpha] = useState(initial.alpha);
    const [inputValue, setInputValue] = useState('');

    useEffect(() => {
        const parsed = parseColorString(color);
        setLocalColor(parsed.hex);
        setAlpha(parsed.alpha);
    }, [color]);

    useEffect(() => {
        const next = supportsAlpha && alpha < 1
            ? formatHexWithAlpha(localColor, alpha)
            : localColor.toUpperCase();
        setInputValue(next);
    }, [localColor, alpha, supportsAlpha]);

    const handleColorChange = (newColor: string) => {
        setLocalColor(newColor);
        applyColor(newColor, alpha);
    };

    const handleAlphaChange = (newAlpha: number) => {
        setAlpha(newAlpha);
        applyColor(localColor, newAlpha);
    };

    const applyColor = (hexColor: string, alphaValue: number) => {
        let finalColor = hexColor;
        if (supportsAlpha) {
            if (alphaValue === 0) {
                finalColor = 'transparent';
            } else if (alphaValue === 1) {
                finalColor = hexColor;
            } else {
                finalColor = formatHexWithAlpha(hexColor, alphaValue);
            }
        }
        onChange(finalColor);
    };

    const displayHex = inputValue;

    return (
        <div className="mb-4 last:mb-0">
            <div className="flex justify-between items-center mb-1">
                <label className="text-xs text-gray-400 block font-bold uppercase">{label}</label>
                <button
                    onClick={onPick}
                    className="text-gray-400 hover:text-blue-400 p-1 rounded hover:bg-gray-700 transition-colors"
                    title={`Pick ${label.toLowerCase()} color from canvas`}
                >
                    <Pipette size={14} />
                </button>
            </div>
            <div className="space-y-2">
                <div className="flex items-center space-x-2">
                    <input
                        type="color"
                        value={localColor}
                        onChange={(e) => handleColorChange(e.target.value)}
                        className="w-full h-8 cursor-pointer rounded bg-transparent border-0 p-0"
                    />
                    <input
                        type="text"
                        value={displayHex}
                        onChange={(e) => {
                            const val = e.target.value;
                            setInputValue(val);
                            if (val.startsWith('rgb')) {
                                const parsed = parseColorString(val);
                                setLocalColor(parsed.hex);
                                setAlpha(parsed.alpha);
                                applyColor(parsed.hex, parsed.alpha);
                                return;
                            }

                            const hexPattern = supportsAlpha ? /^#[0-9A-Fa-f]{0,8}$/ : /^#[0-9A-Fa-f]{0,6}$/;
                            if (!hexPattern.test(val)) return;

                            if (val.length === 7) {
                                setLocalColor(val);
                                handleColorChange(val);
                            } else if (supportsAlpha && val.length === 9) {
                                const parsed = parseColorString(val);
                                setLocalColor(parsed.hex);
                                setAlpha(parsed.alpha);
                                applyColor(parsed.hex, parsed.alpha);
                            }
                        }}
                        className="w-20 px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                </div>

                {supportsAlpha && (
                    <div>
                        <label className="text-xs text-gray-400 block mb-1">
                            Opacity: {Math.round(alpha * 100)}%
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={alpha}
                            onChange={(e) => handleAlphaChange(parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export const DualColorPicker: React.FC<DualColorPickerProps> = ({
    strokeColor,
    fillColor,
    activeType,
    onColorChange,
    onActiveTypeChange,
    onPick
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<'current' | 'preset'>('current');
    const pickerRef = useRef<HTMLDivElement>(null);

    // Global color presets
    const colorPresets = useStore(state => state.colorPresets);
    const addColorPreset = useStore(state => state.addColorPreset);
    const updateColorPreset = useStore(state => state.updateColorPreset);
    const selectColorPreset = useStore(state => state.selectColorPreset);
    const selectedPresetIndex = useStore(state => state.selectedPresetIndex);
    const selectedPreset = selectedPresetIndex !== null ? colorPresets[selectedPresetIndex] : null;

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setEditTarget('current');
        }
    }, [isOpen]);

    useEffect(() => {
        if (selectedPresetIndex === null) {
            setEditTarget('current');
        }
    }, [selectedPresetIndex]);

    const displayStrokeColor = editTarget === 'preset' && selectedPreset ? selectedPreset.stroke : strokeColor;
    const displayFillColor = editTarget === 'preset' && selectedPreset ? selectedPreset.fill : fillColor;

    const handleColorChange = (type: 'stroke' | 'fill', color: string) => {
        if (editTarget === 'preset' && selectedPresetIndex !== null) {
            updateColorPreset(selectedPresetIndex, { [type]: color });
            return;
        }
        onColorChange(type, color);
    };

    return (
        <div className="relative group" ref={pickerRef}>
            {/* Split Box */}
            <div className="w-12 flex items-center justify-center border-b border-gray-600 pb-2">
                <div className="w-8 h-8 rounded border border-gray-600 relative overflow-hidden shadow-md transition-shadow duration-150 hover:shadow-lg">

                    {/* Visual Background for Transparency (entire box) */}
                    <div
                        className="absolute inset-0"
                        style={{
                            backgroundImage: 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)',
                            backgroundSize: '8px 8px',
                            backgroundColor: '#fff'
                        }}
                    />

                    {/* Stroke Triangle (Top Left) */}
                    <div
                        className={`absolute inset-0 cursor-pointer hover:opacity-90 transition-opacity z-10 ${activeType === 'stroke' ? 'ring-2 ring-blue-500 border-transparent' : ''}`}
                        style={{
                            clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                            backgroundColor: strokeColor
                        }}
                        onClick={() => {
                            setEditTarget('current');
                            onActiveTypeChange('stroke');
                            setIsOpen(true);
                        }}
                        title="Stroke Color"
                    />

                    {/* Fill Triangle (Bottom Right) */}
                    <div
                        className={`absolute inset-0 cursor-pointer hover:opacity-90 transition-opacity z-10 ${activeType === 'fill' ? 'ring-2 ring-blue-500 border-transparent' : ''}`}
                        style={{
                            clipPath: 'polygon(100% 100%, 100% 0, 0 100%)',
                            backgroundColor: fillColor === 'transparent' ? 'transparent' : fillColor
                        }}
                        onClick={() => {
                            setEditTarget('current');
                            onActiveTypeChange('fill');
                            setIsOpen(true);
                        }}
                        title="Fill Color"
                    />
                </div>
            </div>

            {/* Presets List */}
            <div className="mt-2 flex flex-col gap-1 w-12 items-center max-h-[300px] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent">
                {colorPresets.map((preset, i) => (
                    <div
                        key={i}
                        className={`w-8 h-8 shrink-0 rounded border cursor-pointer relative overflow-hidden ${selectedPresetIndex === i ? 'ring-2 ring-blue-500 border-transparent' : 'border-gray-600 hover:border-gray-400'}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (selectedPresetIndex === i) {
                                // Already selected - open color picker
                                setEditTarget('preset');
                                setIsOpen(true);
                            } else {
                                // Select this preset
                                selectColorPreset(i);
                            }
                        }}
                        title={`Stroke: ${preset.stroke}, Fill: ${preset.fill}`}
                    >
                        {/* Transparency background */}
                        <div
                            className="absolute inset-0"
                            style={{
                                backgroundImage: 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)',
                                backgroundSize: '8px 8px',
                                backgroundColor: '#fff'
                            }}
                        />
                        {/* Stroke Triangle (Top Left) */}
                        <div
                            className="absolute inset-0"
                            style={{
                                clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                                backgroundColor: preset.stroke
                            }}
                        />
                        {/* Fill Triangle (Bottom Right) */}
                        <div
                            className="absolute inset-0"
                            style={{
                                clipPath: 'polygon(100% 100%, 100% 0, 0 100%)',
                                backgroundColor: preset.fill
                            }}
                        />
                    </div>
                ))}

                {colorPresets.length < 32 && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            addColorPreset({ stroke: strokeColor, fill: fillColor });
                        }}
                        className="w-8 h-8 shrink-0 flex items-center justify-center rounded border border-gray-600 hover:border-green-400 text-gray-400 hover:text-green-400 bg-gray-800 transition-colors"
                        title="Add current color as preset"
                    >
                        <Plus size={16} />
                    </button>
                )}
            </div>

            {/* Popup */}
            {isOpen && (
                <div className="absolute top-0 left-full ml-4 bg-gray-800 border border-gray-600 rounded-md shadow-xl p-3 z-50 min-w-[200px]">
                    <ColorSection
                        label="Stroke"
                        color={displayStrokeColor}
                        onChange={(c) => handleColorChange('stroke', c)}
                        onPick={() => {
                            onActiveTypeChange('stroke');
                            onPick();
                            setIsOpen(false);
                        }}
                    />

                    <div className="h-px bg-gray-600 my-3"></div>

                    <ColorSection
                        label="Fill"
                        color={displayFillColor}
                        onChange={(c) => handleColorChange('fill', c)}
                        onPick={() => {
                            onActiveTypeChange('fill');
                            onPick();
                            setIsOpen(false);
                        }}
                        supportsAlpha
                    />
                </div>
            )}
        </div>
    );
};

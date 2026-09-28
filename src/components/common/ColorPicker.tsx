import React, { useState, useRef, useEffect } from 'react';
import { Pipette } from 'lucide-react';

interface ColorPickerProps {
    color: string;
    onChange: (color: string) => void;
    supportsAlpha?: boolean;
    onPick?: () => void;
    menuAlign?: 'left' | 'right';
}

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

export const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange, supportsAlpha = false, onPick, menuAlign = 'left' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const initial = parseColorString(color);
    const [localColor, setLocalColor] = useState(initial.hex);
    const [alpha, setAlpha] = useState(initial.alpha);
    const [inputValue, setInputValue] = useState('');
    const pickerRef = useRef<HTMLDivElement>(null);

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

    const handleColorChange = (newColor: string) => {
        setLocalColor(newColor);
        applyColor(newColor, alpha);
    };

    const handleAlphaChange = (newAlpha: number) => {
        setAlpha(newAlpha);
        applyColor(localColor, newAlpha);
    };

    const applyColor = (hexColor: string, alphaValue: number) => {
        if (supportsAlpha) {
            if (alphaValue === 0) {
                onChange('transparent');
            } else if (alphaValue === 1) {
                onChange(hexColor);
            } else {
                onChange(formatHexWithAlpha(hexColor, alphaValue));
            }
        } else {
            onChange(hexColor);
        }
    };

    const displayColor = alpha === 0 ? 'transparent' : localColor;
    const displayHex = inputValue;

    return (
        <div className="relative" ref={pickerRef}>
            <div
                className="w-6 h-6 rounded-sm border-2 border-gray-500 cursor-pointer hover:border-gray-400 transition-colors relative overflow-hidden"
                onClick={() => setIsOpen(!isOpen)}
            >
                {/* Checkerboard pattern for transparency */}
                {supportsAlpha && (
                    <div
                        className="absolute inset-0"
                        style={{
                            backgroundImage: 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)',
                            backgroundSize: '8px 8px',
                            backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                        }}
                    />
                )}
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundColor: displayColor,
                        opacity: alpha
                    }}
                />
            </div>

            {isOpen && (
                <div className={`absolute top-full mt-1 ${menuAlign === 'right' ? 'right-0' : 'left-0'} bg-gray-800 border border-gray-600 rounded-md shadow-xl p-3 z-50 min-w-[200px]`}>
                    <div className="space-y-3">
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs text-gray-400 block">Color</label>
                                {onPick && (
                                    <button
                                        onClick={() => {
                                            onPick();
                                            setIsOpen(false);
                                        }}
                                        className="text-gray-400 hover:text-blue-400 p-1 rounded hover:bg-gray-700 transition-colors"
                                        title="Pick color from canvas"
                                    >
                                        <Pipette size={14} />
                                    </button>
                                )}
                            </div>
                            <div className="flex items-center space-x-2">
                                <input
                                    type="color"
                                    value={localColor}
                                    onChange={(e) => handleColorChange(e.target.value)}
                                    className="w-full h-8 cursor-pointer rounded"
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
                                    className="w-full"
                                />
                            </div>
                        )}

                        <div className="flex flex-wrap gap-1">
                            <div className="text-xs text-gray-400 w-full mb-1">Presets:</div>
                            {['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'].map((preset) => (
                                <div
                                    key={preset}
                                    className="w-6 h-6 rounded cursor-pointer border border-gray-600 hover:border-gray-400"
                                    style={{ backgroundColor: preset }}
                                    onClick={() => handleColorChange(preset)}
                                />
                            ))}
                            {supportsAlpha && (
                                <div
                                    className="w-6 h-6 rounded cursor-pointer border border-gray-600 hover:border-gray-400 relative overflow-hidden"
                                    onClick={() => handleAlphaChange(0)}
                                >
                                    <div
                                        className="absolute inset-0"
                                        style={{
                                            backgroundImage: 'linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)',
                                            backgroundSize: '6px 6px',
                                            backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px'
                                        }}
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-[1px] h-[120%] bg-red-500 rotate-45" />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

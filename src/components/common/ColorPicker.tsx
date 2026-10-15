import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Pipette } from 'lucide-react';

/** Viewport coordinates of the portalled panel (`position: fixed`). */
interface PanelPosition {
    top: number;
    left: number;
    transform: string;
    /** Viewport height cap in px; `undefined` when the panel fits uncapped. */
    maxHeight: number | undefined;
}

// Gap between the swatch and the panel (the old `mt-1`) plus the minimum
// distance the panel keeps from the viewport edges.
const PANEL_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

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
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const initial = parseColorString(color);
    const [localColor, setLocalColor] = useState(initial.hex);
    const [alpha, setAlpha] = useState(initial.alpha);
    const [inputValue, setInputValue] = useState('');
    const pickerRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<PanelPosition | null>(null);

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
            const target = e.target as Node;
            // The panel is portalled out of `pickerRef`, so it is checked separately.
            if (pickerRef.current?.contains(target)) return;
            if (panelRef.current?.contains(target)) return;
            setIsOpen(false);
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            // Dismiss the popover only, not the editor's window-level Escape
            // (canvas cancel / clear selection) as well.
            event.stopPropagation();
            setIsOpen(false);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    /**
     * Anchor the portalled panel to the swatch's live viewport rect. Runs on
     * open, again once the panel mounts (so its width can bound the viewport
     * clamp), and on any window resize / ancestor scroll (capture phase -- scroll
     * does not bubble out of the MFP panel's scroll container).
     */
    const measure = useCallback(() => {
        const trigger = pickerRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        // The anchor has scrolled out of view: there is nothing left to point at.
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
            setIsOpen(false);
            return;
        }
        const transform = menuAlign === 'right' ? 'translateX(-100%)' : 'none';
        const anchor = menuAlign === 'right' ? rect.right : rect.left;
        // Keep the panel inside the viewport once its rendered width is known
        // (the right-edge clip this portal exists to fix).
        const width = panelRef.current?.offsetWidth ?? 0;
        const shift = menuAlign === 'right' ? width : 0;
        const min = VIEWPORT_MARGIN_PX + shift;
        const max = window.innerWidth - VIEWPORT_MARGIN_PX - (width - shift);
        const left = width > 0 && max >= min ? Math.min(Math.max(anchor, min), max) : anchor;
        // Vertical: the panel opens below the swatch, which runs offscreen near
        // the viewport bottom. Once its height is known, flip it above when it
        // does not fit below and there is more room above; otherwise clamp `top`
        // inside the viewport and cap the height so the panel scrolls.
        const height = panelRef.current?.offsetHeight ?? 0;
        const belowTop = rect.bottom + PANEL_GAP_PX;
        const spaceBelow = window.innerHeight - VIEWPORT_MARGIN_PX - belowTop;
        const spaceAbove = rect.top - PANEL_GAP_PX - VIEWPORT_MARGIN_PX;
        const flipped = height > 0 && height > spaceBelow && spaceAbove > spaceBelow;
        let top = flipped ? rect.top - PANEL_GAP_PX - height : belowTop;
        let maxHeight: number | undefined;
        if (height > 0) {
            top = Math.min(
                Math.max(top, VIEWPORT_MARGIN_PX),
                Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - VIEWPORT_MARGIN_PX - height),
            );
            maxHeight = flipped
                ? Math.max(0, rect.top - PANEL_GAP_PX - VIEWPORT_MARGIN_PX)
                : Math.max(0, window.innerHeight - VIEWPORT_MARGIN_PX - top);
        }
        const next: PanelPosition = { top, left, transform, maxHeight };
        // No-op guard: runs on every scroll frame, and keeps the StrictMode
        // effect/ref replay from causing a state churn loop.
        setPos((prev) =>
            prev &&
            prev.top === next.top &&
            prev.left === next.left &&
            prev.transform === next.transform &&
            prev.maxHeight === next.maxHeight
                ? prev
                : next,
        );
    }, [menuAlign]);

    // The panel has to be mounted before `measure` can read its width, so refine
    // the position once the node attaches.
    const attachPanel = useCallback(
        (node: HTMLDivElement | null) => {
            panelRef.current = node;
            if (node) measure();
        },
        [measure],
    );

    const toggleOpen = () => {
        if (isOpen) {
            setIsOpen(false);
            return;
        }
        measure();
        setIsOpen(true);
    };

    useEffect(() => {
        if (!isOpen) return;
        const reposition = () => measure();
        // Capture phase: a scroll inside the MFP panel never reaches window by bubbling.
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
        return () => {
            window.removeEventListener('scroll', reposition, true);
            window.removeEventListener('resize', reposition);
        };
    }, [isOpen, measure]);

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
                onClick={toggleOpen}
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

            {/* Panel -- portalled to <body> so it escapes the MFP panel's
                overflow-y-auto scroll clip and its right edge. */}
            {isOpen && pos && createPortal(
                <div
                    ref={attachPanel}
                    data-testid="color-picker-panel"
                    className="fixed z-50 bg-gray-800 text-gray-100 border border-gray-600 rounded-md shadow-xl p-3 min-w-[200px]"
                    style={{
                        top: `${pos.top}px`,
                        left: `${pos.left}px`,
                        transform: pos.transform,
                        ...(pos.maxHeight !== undefined
                            ? { maxHeight: `${pos.maxHeight}px`, overflowY: 'auto' as const }
                            : {}),
                    }}
                >
                    <div className="space-y-3">
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs text-gray-400 block">{t('colorPicker.color')}</label>
                                {onPick && (
                                    <button
                                        onClick={() => {
                                            onPick();
                                            setIsOpen(false);
                                        }}
                                        className="text-gray-400 hover:text-blue-400 p-1 rounded hover:bg-gray-700 transition-colors"
                                        title={t('colorPicker.pickFromCanvas')}
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
                                    {t('colorPicker.opacity', { percent: Math.round(alpha * 100) })}
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
                            <div className="text-xs text-gray-400 w-full mb-1">{t('colorPicker.presets')}</div>
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
                </div>,
                document.body,
            )}
        </div>
    );
};

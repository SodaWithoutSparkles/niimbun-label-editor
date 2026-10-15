import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Minus, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

/** Viewport coordinates of the portalled panel (`position: fixed`). */
interface PanelPosition {
    top: number;
    left: number;
    transform: string;
    /** Side of the trigger the panel sits on (drives the arrow direction). */
    placement: 'above' | 'below';
    /** Viewport height cap in px; `undefined` when the panel fits uncapped. */
    maxHeight: number | undefined;
}

// Gap between the trigger and the panel (the old `mt-2`) plus the minimum
// distance the panel keeps from the viewport edges.
const PANEL_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

interface PopoverSliderProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    bigStep?: number;
    // Button step (applies to the small +/- buttons). Defaults to `step` when unset.
    buttonStep?: number;
    label?: string;
    unit?: string;

    // Display customization
    valueDisplay?: (value: number) => React.ReactNode;

    // Feature toggles
    hideSlider?: boolean;
    hideInput?: boolean;
    hideButtons?: boolean;

    // Presets
    presets?: { label: string; value: number }[];
    // Layout for presets grid
    presetsCols?: number; // number of columns (default 2)
    presetsMaxRows?: number; // max visible rows; when set, presets area becomes scrollable
    presetsScrollable?: boolean; // if true, enable scrolling without max rows
    // Column width (px) used when calculating popover min width to fit all columns
    presetsColWidth?: number;

    // Styles
    className?: string;
    popoverClassName?: string;

    // Alignment
    popoverAlign?: 'center' | 'start' | 'end';
}

export const PopoverSlider: React.FC<PopoverSliderProps> = ({
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    bigStep = 10,
    label,
    unit = '',
    valueDisplay,
    hideSlider = false,
    hideInput = false,
    hideButtons = false,
    presets,
    presetsCols = 2,
    presetsMaxRows,
    presetsScrollable = false,
    presetsColWidth = 96,
    buttonStep = step,
    className = '',
    popoverClassName = '',
    popoverAlign = 'center'
}) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [tempValue, setTempValue] = useState(value);
    const [pos, setPos] = useState<PanelPosition | null>(null);

    const arrowStyle = useMemo(() => {
        // A panel flipped above the trigger points its arrow down at it.
        const vertical = pos?.placement === 'above' ? 'translateY(-50%)' : 'translateY(50%)';
        switch (popoverAlign) {
            case 'center':
                return { left: '50%', transform: `translateX(-50%) ${vertical}` };
            case 'start':
                return { left: '16px', transform: `translateX(-50%) ${vertical}` };
            case 'end':
                return { right: '16px', transform: `translateX(-50%) ${vertical}` };
        }
    }, [popoverAlign, pos]);

    useEffect(() => {
        setTempValue(value);
    }, [value]);

    /**
     * Anchor the portalled panel to the trigger's live viewport rect. Runs on
     * open, again once the panel mounts (so its width can bound the viewport
     * clamp), and on any window resize / ancestor scroll (capture phase -- scroll
     * does not bubble out of the MFP panel's scroll container).
     */
    const measure = useCallback(() => {
        const trigger = containerRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        // The anchor has scrolled out of view: there is nothing left to point at.
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
            setIsOpen(false);
            return;
        }
        const transform =
            popoverAlign === 'center'
                ? 'translateX(-50%)'
                : popoverAlign === 'end'
                    ? 'translateX(-100%)'
                    : 'none';
        const anchor =
            popoverAlign === 'center'
                ? rect.left + rect.width / 2
                : popoverAlign === 'end'
                    ? rect.right
                    : rect.left;
        // Keep the panel inside the viewport once its rendered width is known
        // (the right-edge clip this portal exists to fix).
        const width = panelRef.current?.offsetWidth ?? 0;
        const shift = transform === 'translateX(-50%)' ? width / 2 : transform === 'translateX(-100%)' ? width : 0;
        const min = VIEWPORT_MARGIN_PX + shift;
        const max = window.innerWidth - VIEWPORT_MARGIN_PX - (width - shift);
        const left = width > 0 && max >= min ? Math.min(Math.max(anchor, min), max) : anchor;
        // Vertical: the panel opens below the trigger, which runs offscreen near
        // the viewport bottom. Once its height is known, flip it above the
        // trigger when it does not fit below and there is more room above;
        // otherwise clamp `top` inside the viewport and cap the height so the
        // panel scrolls instead of overflowing.
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
        const next: PanelPosition = {
            top,
            left,
            transform,
            placement: flipped ? 'above' : 'below',
            maxHeight,
        };
        // No-op guard: runs on every scroll frame, and keeps the StrictMode
        // effect/ref replay from causing a state churn loop.
        setPos((prev) =>
            prev &&
            prev.top === next.top &&
            prev.left === next.left &&
            prev.transform === next.transform &&
            prev.placement === next.placement &&
            prev.maxHeight === next.maxHeight
                ? prev
                : next,
        );
    }, [popoverAlign]);

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

    // Compute a min width so the popover can fit all preset columns
    const popoverMinWidth = useMemo(() => {
        if (!presets || presets.length === 0) return 200;
        const colWidth = presetsColWidth ?? 96; // px per column
        const gap = 8; // 0.5rem -> 8px (matches grid gap)
        const paddingLR = 32; // p-4 -> 16px left + 16px right
        const total = presetsCols * colWidth + Math.max(0, presetsCols - 1) * gap + paddingLR;
        return Math.max(200, Math.round(total));
    }, [presetsCols, presetsColWidth, presets]);


    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            // The panel is portalled out of `containerRef`, so it is checked separately.
            if (containerRef.current?.contains(target)) return;
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

    const handleConfirm = (newVal: number) => {
        // Clamp to allowed precision based on step
        const rounded = Math.round(newVal / step) * step;
        // Fix float precision issues (e.g. 0.1 + 0.2 = 0.300000004)
        const precision = step.toString().split('.')[1]?.length || 0;
        const fixed = parseFloat(rounded.toFixed(precision));

        let clamped = Math.min(Math.max(fixed, min), max);
        onChange(clamped);
        setTempValue(clamped);
    };

    const handleCommit = () => {
        handleConfirm(tempValue);
    };

    // Continuous Press Logic with acceleration
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const accelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isAcceleratedRef = useRef(false);

    // Timing constants (ms)
    const INITIAL_DELAY = 500; // delay before repeating
    const INITIAL_INTERVAL = 100; // normal repeat interval
    const ACCEL_THRESHOLD = 3000; // time to accelerate (long-long press)
    const ACCEL_FACTOR = 5; // how much faster when accelerated
    const MIN_INTERVAL = 10; // lower bound for interval

    const startContinuous = (action: () => void) => {
        // Execute immediately
        action();

        // Clear any existing timers
        stopContinuous();

        // Start the repeating interval after initial delay
        timerRef.current = setTimeout(() => {
            intervalRef.current = setInterval(() => {
                action();
            }, INITIAL_INTERVAL);
        }, INITIAL_DELAY);

        // Start the acceleration timer which fires after ACCEL_THRESHOLD
        accelTimerRef.current = setTimeout(() => {
            isAcceleratedRef.current = true;
            // Switch to accelerated interval
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = setInterval(() => {
                action();
            }, Math.max(MIN_INTERVAL, Math.round(INITIAL_INTERVAL / ACCEL_FACTOR)));
        }, ACCEL_THRESHOLD);
    };

    const stopContinuous = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (accelTimerRef.current) clearTimeout(accelTimerRef.current);
        timerRef.current = null;
        intervalRef.current = null;
        accelTimerRef.current = null;
        isAcceleratedRef.current = false;
    };

    const valueRef = useRef(value);
    useEffect(() => { valueRef.current = value; }, [value]);

    // Ref-based actions for interval
    const doIncrement = () => handleConfirm(valueRef.current + buttonStep);
    const doDecrement = () => handleConfirm(valueRef.current - buttonStep);
    const doIncrementBig = () => handleConfirm(valueRef.current + bigStep);
    const doDecrementBig = () => handleConfirm(valueRef.current - bigStep);

    const handleMouseDown = (action: () => void) => () => {
        startContinuous(action);
    };

    const handleMouseUp = () => stopContinuous();

    // Clean up on unmount
    useEffect(() => {
        return () => stopContinuous();
    }, []);

    return (
        <div className={`relative inline-block ${className}`} ref={containerRef}>
            {/* Trigger Component */}
            <div
                onClick={toggleOpen}
                className="cursor-pointer group flex items-center gap-1 hover:text-blue-400 transition-colors select-none"
            >
                <div className="border-b-2 border-dashed border-gray-500/50 group-hover:border-blue-500/50 pb-0.5">
                    {valueDisplay ? valueDisplay(value) : (
                        <span className="font-mono text-lg font-bold">
                            {value}{unit}
                        </span>
                    )}
                </div>
                {/* <ChevronDown size={14} className={`text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} /> */}
            </div>

            {/* Popover -- portalled to <body> so it escapes the MFP panel's
                overflow-y-auto scroll clip and its right edge. */}
            {isOpen && pos && createPortal(
                <div
                    ref={attachPanel}
                    data-testid="popover-slider-panel"
                    className={`fixed z-50 p-4 bg-gray-900 text-gray-100 border border-gray-700 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${popoverClassName}`}
                    style={{
                        top: `${pos.top}px`,
                        left: `${pos.left}px`,
                        transform: pos.transform,
                        ...(pos.maxHeight !== undefined
                            ? { maxHeight: `${pos.maxHeight}px`, overflowY: 'auto' as const }
                            : {}),
                        minWidth: `${popoverMinWidth}px`,
                        maxWidth: '90vw',
                        width: 'auto'
                    }}
                >
                    {label && <div className="text-xs text-gray-400 mb-3 font-semibold uppercase tracking-wider">{label}</div>}

                    <div className="space-y-4">
                        {/* Input Row */}
                        {!hideInput && (
                            <div className="flex items-center gap-1">
                                {!hideButtons && (
                                    <>
                                        <button
                                            onMouseDown={handleMouseDown(doDecrementBig)}
                                            onMouseUp={handleMouseUp}
                                            onMouseLeave={handleMouseUp}
                                            onTouchStart={handleMouseDown(doDecrementBig)}
                                            onTouchEnd={handleMouseUp}
                                            className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-white transition-colors"
                                            title={`-${bigStep}`}
                                        >
                                            <ChevronLeft size={16} />
                                        </button>
                                        <button
                                            onMouseDown={handleMouseDown(doDecrement)}
                                            onMouseUp={handleMouseUp}
                                            onMouseLeave={handleMouseUp}
                                            onTouchStart={handleMouseDown(doDecrement)}
                                            onTouchEnd={handleMouseUp}
                                            className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                                            title={`-${buttonStep}`}
                                        >
                                            <Minus size={16} />
                                        </button>
                                    </>
                                )}
                                <div className="relative flex-1 min-w-[60px]">
                                    <input
                                        type="number"
                                        value={tempValue}
                                        onChange={(e) => {
                                            const v = Number(e.target.value);
                                            setTempValue(v);
                                            onChange(v);
                                        }}
                                        className="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1 text-center font-mono text-sm focus:ring-1 focus:ring-blue-500 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCommit();
                                        }}
                                        min={min}
                                        max={max}
                                        step={step}
                                    />
                                    {unit && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">{unit}</span>}
                                </div>
                                {!hideButtons && (
                                    <>
                                        <button
                                            onMouseDown={handleMouseDown(doIncrement)}
                                            onMouseUp={handleMouseUp}
                                            onMouseLeave={handleMouseUp}
                                            onTouchStart={handleMouseDown(doIncrement)}
                                            onTouchEnd={handleMouseUp}
                                            className="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors"
                                            title={`+${buttonStep}`}
                                        >
                                            <Plus size={16} />
                                        </button>
                                        <button
                                            onMouseDown={handleMouseDown(doIncrementBig)}
                                            onMouseUp={handleMouseUp}
                                            onMouseLeave={handleMouseUp}
                                            onTouchStart={handleMouseDown(doIncrementBig)}
                                            onTouchEnd={handleMouseUp}
                                            className="p-1 hover:bg-gray-800 rounded text-gray-500 hover:text-white transition-colors"
                                            title={`+${bigStep}`}
                                        >
                                            <ChevronRight size={16} />
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Slider */}
                        {!hideSlider && (
                            <input
                                type="range"
                                min={min}
                                max={max}
                                step={step}
                                value={value}
                                onChange={(e) => handleConfirm(Number(e.target.value))}
                                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400"
                            />
                        )}

                        {/* Presets */}
                        {presets && presets.length > 0 && (
                            <div
                                className="pt-2 border-t border-gray-800"
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: `repeat(${presetsCols}, minmax(0, 1fr))`,
                                    gap: '0.5rem',
                                    maxHeight: presetsMaxRows ? `${presetsMaxRows * 40}px` : presetsScrollable ? '8rem' : undefined,
                                    overflowY: presetsMaxRows || presetsScrollable ? 'auto' : undefined,
                                }}
                                role="list"
                                aria-label={t('popoverSlider.presets')}
                            >
                                {presets.map((p) => (
                                    <button
                                        key={p.label}
                                        onClick={() => handleConfirm(p.value)}
                                        className="text-xs bg-gray-800 hover:bg-gray-700 py-1.5 rounded text-gray-300 transition-colors min-h-[36px]"
                                        role="listitem"
                                    >
                                        {p.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Arrow */}
                    <div
                        className={
                            pos.placement === 'below'
                                ? 'absolute -top-1.5 w-3 h-3 bg-gray-900 border-l border-t border-gray-700 transform rotate-45'
                                : 'absolute -bottom-1.5 w-3 h-3 bg-gray-900 border-r border-b border-gray-700 transform rotate-45'
                        }
                        style={arrowStyle}
                    />
                </div>,
                document.body,
            )}
        </div>
    );
};

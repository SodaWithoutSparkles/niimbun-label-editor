import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { Minus, Plus, ChevronLeft, ChevronRight } from 'lucide-react';

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
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [tempValue, setTempValue] = useState(value);
    const [popoverAnchor, setPopoverAnchor] = useState<number | null>(null);

    const arrowStyle = useMemo(() => {
        switch (popoverAlign) {
            case 'center':
                return { left: '50%', transform: 'translateX(-50%) translateY(50%)' };
            case 'start':
                return { left: '16px', transform: 'translateX(-50%) translateY(50%)' };
            case 'end':
                return { right: '16px', transform: 'translateX(-50%) translateY(50%)' };
        }
    }, [popoverAlign]);

    useEffect(() => {
        setTempValue(value);
    }, [value]);

    useLayoutEffect(() => {
        if (isOpen && containerRef.current && popoverAlign === 'center') {
            setPopoverAnchor(containerRef.current.offsetWidth / 2);
        } else {
            setPopoverAnchor(null);
        }
    }, [isOpen, popoverAlign]);

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
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
                onClick={() => setIsOpen(!isOpen)}
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

            {/* Popover */}
            {isOpen && (
                <div
                    className={`absolute z-50 top-full mt-2 p-4 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${popoverClassName}`}
                    style={{
                        left: popoverAlign === 'center'
                            ? (popoverAnchor !== null ? `${popoverAnchor}px` : '50%')
                            : popoverAlign === 'start' ? '0' : 'auto',
                        right: popoverAlign === 'end' ? '0' : 'auto',
                        transform: popoverAlign === 'center' ? 'translateX(-50%)' : 'none',
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
                                aria-label="presets"
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
                        className="absolute -top-1.5 w-3 h-3 bg-gray-900 border-l border-t border-gray-700 transform rotate-45"
                        style={arrowStyle}
                    />
                </div>
            )}
        </div>
    );
};

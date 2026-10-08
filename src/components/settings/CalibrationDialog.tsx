import React from 'react';
import { useTranslation } from 'react-i18next';
import { MM_PER_INCH } from '../../core/hm';
import { useStore } from '../../store/useStore';
import { SCREEN_DPI_MAX, SCREEN_DPI_MIN } from '../../store/storeDefaults';
import { Modal } from '../common/dialogs';
import { SettingRow } from '../common/forms';

interface CalibrationDialogProps {
    open: boolean;
    onClose: () => void;
}

/** Reference length of the on-screen ruler, in millimetres. */
const REFERENCE_MM = 100;
/** Minor tick spacing; every second minor tick is a labelled major tick. */
const MINOR_TICK_MM = 5;
const MAJOR_TICK_EVERY = 2;

/**
 * Screen px a physical length occupies -- the inverse of `realZoom`
 * (`core/viewport.ts`). Args are `(mm, dpi)` to match the spec formula
 * `mm * dpi / 25.4`. Both args are numbers, so a swapped call would still
 * type-check -- keep this order at every call site.
 *
 * `devicePixelRatio` deliberately does not enter here: CSS px already are the
 * browser's screen units, which is what `real` zoom estimates too.
 */
const pxForMm = (mm: number, dpi: number): number => (mm / MM_PER_INCH) * dpi;

/**
 * Tick positions in mm, 0..REFERENCE_MM. A module constant, not a `useMemo`:
 * the pattern depends only on the reference length, never on the DPI.
 */
const RULER_TICKS_MM = Array.from(
    { length: Math.floor(REFERENCE_MM / MINOR_TICK_MM) + 1 },
    (_, index) => index * MINOR_TICK_MM
);

/**
 * Screen-DPI calibration: an on-screen ruler the user matches against a real
 * one, with a slider that writes the store live.
 *
 * There is no local copy of the DPI -- the committed `screenDpi` IS the
 * displayed value, so the ruler can never disagree with what `real` zoom uses.
 * `setScreenDpi` owns clamping/rounding/persisting, so every control (slider,
 * nudges) sends a raw value and simply renders whatever comes back.
 */
export const CalibrationDialog: React.FC<CalibrationDialogProps> = ({ open, onClose }) => {
    const { t } = useTranslation();
    const screenDpi = useStore((state) => state.screenDpi);
    const setScreenDpi = useStore((state) => state.setScreenDpi);

    // A definite width (not a %) is the whole point: the bar's on-screen length
    // must equal `pxForMm(REFERENCE_MM, screenDpi)` for the match to be real.
    // At 400 dpi that is 1575 px, so the ruler scrolls instead of overflowing.
    const rulerWidthPx = pxForMm(REFERENCE_MM, screenDpi).toFixed(2);

    const nudge = (delta: number) => () => setScreenDpi(screenDpi + delta);

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={t('settings.general.calibrationTitle')}
            size="lg"
            footer={
                // Writes are live, and X / Escape / the backdrop all dismiss
                // without reverting -- so this closes, it does not confirm.
                <button
                    type="button"
                    onClick={onClose}
                    className="rounded bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-500"
                >
                    {t('dialog.close')}
                </button>
            }
        >
            <div className="space-y-6">
                <p className="text-sm text-gray-300">
                    {t('settings.general.calibrationDescription')}
                </p>

                <div className="rounded border border-gray-700 bg-gray-800/40 p-4">
                    {/*
                      The scroller needs a DEFINITE height that outlasts the
                      ruler plus its own horizontal scrollbar: with
                      `overflow-x: auto` on an auto-height box, `overflow-y`
                      computes to `auto` and the scrollbar is carved out of the
                      content box, clipping the ruler's baseline and its ticks
                      whenever the ruler is wider than the scrollport (dpi >=
                      ~145, i.e. the normal case). `h-24` (96px) vs the 64px
                      ruler leaves room for a 15-17px scrollbar,
                      `overflow-y-hidden` keeps the y axis from ever becoming a
                      scrollport itself, `items-center` centres the ruler in what
                      is left, and `px-3` keeps the end labels off the scroller
                      edges. `shrink-0` (below) is load-bearing here: without it
                      flex would shrink the ruler instead of scrolling it.
                    */}
                    <div className="flex h-24 items-center overflow-x-auto overflow-y-hidden px-3">
                        <div
                            data-testid="calibration-ruler"
                            role="img"
                            aria-label={t('settings.general.calibrationRulerAria', { mm: REFERENCE_MM })}
                            style={{ width: `${rulerWidthPx}px` }}
                            className="relative h-16 shrink-0"
                        >
                            {RULER_TICKS_MM.map((mm, index) => {
                                const major = index % MAJOR_TICK_EVERY === 0;
                                const at = `${(mm / REFERENCE_MM) * 100}%`;
                                return (
                                    <React.Fragment key={mm}>
                                        {major && (
                                            <span
                                                className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-gray-300"
                                                style={{ left: at }}
                                            >
                                                {mm}
                                            </span>
                                        )}
                                        <span
                                            aria-hidden="true"
                                            className={`absolute bottom-0 w-px bg-gray-400 ${major ? 'h-5' : 'h-2.5'}`}
                                            style={{ left: at }}
                                        />
                                    </React.Fragment>
                                );
                            })}
                            {/* Baseline the ticks stand on, drawn over their feet. */}
                            <span className="absolute bottom-0 left-0 h-px w-full bg-gray-500" />
                        </div>
                    </div>
                    <p className="mt-4 text-center text-xs text-gray-400">
                        {t('settings.general.calibrationReference', { mm: REFERENCE_MM })}
                    </p>
                </div>

                <SettingRow label={t('settings.general.screenDpi')}>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={nudge(-1)}
                            aria-label={t('settings.general.calibrationDecrease')}
                            title={t('settings.general.calibrationDecrease')}
                            className="rounded border border-gray-600 px-2 py-0.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
                        >
                            −
                        </button>
                        <input
                            type="range"
                            min={SCREEN_DPI_MIN}
                            max={SCREEN_DPI_MAX}
                            step={1}
                            value={screenDpi}
                            onChange={(event) => setScreenDpi(Number(event.target.value))}
                            className="w-56 accent-blue-500"
                            aria-label={t('settings.general.screenDpi')}
                            // The raw number is meaningless to a screen reader
                            // ("slider, 96 of 24 to 400"); name the unit.
                            aria-valuetext={t('settings.general.calibrationValueText', { dpi: screenDpi })}
                        />
                        <button
                            type="button"
                            onClick={nudge(1)}
                            aria-label={t('settings.general.calibrationIncrease')}
                            title={t('settings.general.calibrationIncrease')}
                            className="rounded border border-gray-600 px-2 py-0.5 text-sm text-gray-200 transition-colors hover:bg-gray-700"
                        >
                            +
                        </button>
                    </div>
                </SettingRow>

                <p aria-live="polite" className="text-sm text-gray-200">
                    {t('settings.general.calibrationCurrent', { dpi: screenDpi })}
                </p>
            </div>
        </Modal>
    );
};
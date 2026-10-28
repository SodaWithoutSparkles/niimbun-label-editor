import Konva from 'konva';
import type { TextWrap } from '../../core/doc/objects';

/**
 * Text measurement + shrink-to-fit, shared by the preview (`ResolvedShape`) and
 * the print factory (`konvaFactory`) so the shrink scale never drifts between
 * them (P5 D2a).
 *
 * The node is built detached (never added to a Stage) with the box `width` but
 * no fixed `height`, so Konva lays out every wrapped line and `getHeight()` is
 * the full wrapped height. The scale is shrink-only: `min(1, …)` means a string
 * that already fits is never upscaled.
 */

export interface TextMetricsInput {
    text: string;
    /** Box width in the same unit as `height` (Konva measures in that space). */
    width: number;
    /** Box height. */
    height: number;
    fontSize: number;
    fontFamily: string;
    fontStyle: string;
    /** `shrink` measures with `'word'`; `char` is only a rendering choice. */
    wrap: Extract<TextWrap, 'word' | 'char'>;
    lineHeight: number;
    /** Extra inter-character spacing in px; must match the rendered node. */
    letterSpacing?: number;
}

export interface TextMetrics {
    /** Measured wrapped text width. */
    width: number;
    /** Measured full wrapped text height. */
    height: number;
    /** Uniform shrink factor; always `≤ 1`. */
    scale: number;
}

/**
 * The fields a text node's live layout depends on. `width`/`height` are the
 * node box (hm); the rest must be the rendered values, never a default.
 */
export interface ShrinkableText {
    text: string;
    width: number;
    height: number;
    fontSize: number;
    fontFamily: string;
    fontStyle: string;
    lineHeight: number;
    letterSpacing?: number;
}

export const measureKonvaText = (input: TextMetricsInput): TextMetrics => {
    const measured = new Konva.Text({
        text: input.text,
        width: input.width,
        fontSize: input.fontSize,
        fontFamily: input.fontFamily,
        fontStyle: input.fontStyle,
        wrap: input.wrap,
        lineHeight: input.lineHeight,
        letterSpacing: input.letterSpacing ?? 0,
        padding: 0,
    });
    // `getTextWidth()` is the widest wrapped line; `getHeight()` is the full
    // wrapped height because the detached node carries no fixed height.
    const width = measured.getTextWidth();
    const height = measured.getHeight();
    // Guard a zero/negative measurement so a degenerate box yields scale 1
    // (scale is capped at 1 anyway, so this only avoids a divide-by-zero).
    const sx = width > 0 ? input.width / width : 1;
    const sy = height > 0 ? input.height / height : 1;
    const scale = Math.min(1, sx, sy);
    return { width, height, scale };
};

/**
 * The `shrink`-only uniform factor: `1` for any text that already fits.
 *
 * `shrink` always measures with `'word'` wrapping (`measureKonvaText`), which is
 * what both renderers use for the `Konva.Text` wrap prop, so the measured scale
 * is the factor the rendered node must be multiplied by. The preview, the print
 * factory, the inline editor and the overlay placement all read this one helper
 * so the four can never drift.
 */
export const shrinkScaleOf = (text: ShrinkableText): number =>
    measureKonvaText({ ...text, wrap: 'word' }).scale;

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
}

export interface TextMetrics {
    /** Measured wrapped text width. */
    width: number;
    /** Measured full wrapped text height. */
    height: number;
    /** Uniform shrink factor; always `≤ 1`. */
    scale: number;
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

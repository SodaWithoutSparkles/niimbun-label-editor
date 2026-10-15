/**
 * Bold/italic text style — pure helpers over a `TextNode.fontStyle` string.
 *
 * The document model has **no** `fontWeight` field (see `core/doc/types.ts`):
 * weight and slant ride one combined CSS/Konva `fontStyle` string, the same
 * shape Konva and the canvas `font` shorthand accept. The canonical value is
 * `'normal' | 'bold' | 'italic' | 'bold italic'`; an absent or empty style is
 * `'normal'`. Every render path passes this string through verbatim, so bold +
 * italic round-trips to the print/raster glyphs unchanged.
 */

export type FontStyleToken = 'bold' | 'italic';

/** Canonical order: weight before slant (`'bold italic'`). */
export const FONT_STYLE_TOKENS: readonly FontStyleToken[] = ['bold', 'italic'];

/** Whether a `fontStyle` string carries the given token. */
export const hasFontStyleToken = (style: string | undefined, token: FontStyleToken): boolean =>
    (style ?? '').split(/\s+/).includes(token);

/** `init → 'normal'`, keeping only the recognised tokens in canonical order. */
export const normalizeFontStyle = (style: string | undefined): string => {
    const enabled = FONT_STYLE_TOKENS.filter((token) => hasFontStyleToken(style, token));
    return enabled.length > 0 ? enabled.join(' ') : 'normal';
};

/** Add or remove one token, returning the canonical combined string. */
export const setFontStyleToken = (
    style: string | undefined,
    token: FontStyleToken,
    on: boolean,
): string => {
    const present = new Set(FONT_STYLE_TOKENS.filter((entry) => hasFontStyleToken(style, entry)));
    if (on) present.add(token);
    else present.delete(token);
    const enabled = FONT_STYLE_TOKENS.filter((entry) => present.has(entry));
    return enabled.length > 0 ? enabled.join(' ') : 'normal';
};

/** CSS `font-weight` for a node `fontStyle` string (text editor overlay). */
export const fontWeightOf = (style: string | undefined): 'normal' | 'bold' =>
    hasFontStyleToken(style, 'bold') ? 'bold' : 'normal';

/** CSS `font-style` for a node `fontStyle` string (text editor overlay). */
export const fontStyleOf = (style: string | undefined): 'normal' | 'italic' =>
    hasFontStyleToken(style, 'italic') ? 'italic' : 'normal';

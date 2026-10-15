import { describe, expect, it } from 'vitest';
import {
    fontStyleOf,
    fontWeightOf,
    hasFontStyleToken,
    normalizeFontStyle,
    setFontStyleToken,
} from './textStyle';

/**
 * `TextNode.fontStyle` carries weight + slant as one combined string
 * (`'normal' | 'bold' | 'italic' | 'bold italic'`). These pure helpers are the
 * single source of truth for reading and toggling those tokens; the render paths
 * pass the string through verbatim.
 */
describe('textStyle — token helpers', () => {
    it('reads tokens from a combined string (and treats empty/absent as none)', () => {
        expect(hasFontStyleToken('bold italic', 'bold')).toBe(true);
        expect(hasFontStyleToken('bold italic', 'italic')).toBe(true);
        expect(hasFontStyleToken('bold', 'italic')).toBe(false);
        expect(hasFontStyleToken('normal', 'bold')).toBe(false);
        expect(hasFontStyleToken(undefined, 'bold')).toBe(false);
        expect(hasFontStyleToken('', 'italic')).toBe(false);
    });

    it('normalises any empty/unknown style to "normal"', () => {
        expect(normalizeFontStyle(undefined)).toBe('normal');
        expect(normalizeFontStyle('')).toBe('normal');
        expect(normalizeFontStyle('normal')).toBe('normal');
        expect(normalizeFontStyle('bold')).toBe('bold');
    });

    it('adds and removes tokens, always emitting the canonical order', () => {
        expect(setFontStyleToken(undefined, 'bold', true)).toBe('bold');
        expect(setFontStyleToken('bold', 'italic', true)).toBe('bold italic');
        // Italic added first still normalises to weight-then-slant.
        expect(setFontStyleToken('italic', 'bold', true)).toBe('bold italic');
        expect(setFontStyleToken('bold italic', 'bold', false)).toBe('italic');
        expect(setFontStyleToken('italic', 'italic', false)).toBe('normal');
        // Idempotent add.
        expect(setFontStyleToken('bold', 'bold', true)).toBe('bold');
    });

    it('splits the style string for the inline editor’s CSS longhands', () => {
        expect(fontWeightOf('bold italic')).toBe('bold');
        expect(fontWeightOf('italic')).toBe('normal');
        expect(fontWeightOf(undefined)).toBe('normal');
        expect(fontStyleOf('bold italic')).toBe('italic');
        expect(fontStyleOf('bold')).toBe('normal');
        expect(fontStyleOf('normal')).toBe('normal');
    });
});

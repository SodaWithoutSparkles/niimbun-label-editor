/**
 * Per-object option unions (P5).
 *
 * These `as const` arrays are the single source of truth for both runtime
 * validation (`validate.ts` derives its allowed sets from them) and the editor
 * UI (dropdowns render exactly these values). Extending a set is a one-line add
 * here — validation and UI follow automatically. Keep this module pure: no
 * runtime imports, no side effects, so it can be consumed from anywhere.
 */

import type { ShapeKind } from './types';

export const BARCODE_SYMBOLOGIES = [
    'code128',
    'code39',
    'code39ext',
    'code93',
    'code93ext',
    'code11',
    'ean13',
    'ean8',
    'ean5',
    'ean2',
    'upca',
    'upce',
    'upc',
    'itf14',
    'interleaved2of5',
    'industrial2of5',
    'iata2of5',
    'datalogic2of5',
    'matrix2of5',
    'coop2of5',
    'code2of5',
    'pharmacode',
    'pharmacode2',
    'rationalizedCodabar',
    'codabar',
    'msi',
    'plessey',
    'telepen',
] as const;
export type BarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number];
export const DEFAULT_BARCODE_SYMBOLOGY: BarcodeSymbology = 'code128';

export const IMAGE_FITS = ['contain', 'cover', 'stretch'] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];
export const DEFAULT_IMAGE_FIT: ImageFit = 'contain';

/**
 * Symbol background + quiet-zone defaults (P2). `fill` defaults to opaque white:
 * the symbol background (light modules **and** the quiet zone) is painted solid
 * white. An explicit `'transparent'` opts the light modules and quiet zone to see
 * through to whatever is behind; any other colour paints the background (and
 * quiet zone) in that colour, alpha composited. The mask stencil treats any
 * visible (non-zero-alpha) ink as claimed, so the opaque default owns its whole
 * rect and even a low-alpha fill still owns the pixels it tints.
 */
export const DEFAULT_SYMBOL_FILL = '#ffffff';

/**
 * Quiet-zone width per side, in modules. QR needs ≥ 4 (ISO/IEC 18004); 1D
 * symbologies express their requirement in X-modules. `quietZone` is an explicit
 * per-node override; absent ⇒ the derived per-symbology default here.
 */
export const DEFAULT_QR_QUIET_MODULES = 4;
const DEFAULT_BARCODE_QUIET_MODULES = 10;

/** Max quiet-zone width per side (in modules), shared by validation and the UI. */
export const MAX_QUIET_ZONE = 64;

/**
 * Per-symbology 1D quiet-zone requirement, as the **symmetric (larger of
 * left/right) ISO/IEC X-module** figure — this field is one value per side, so
 * the stricter side of an asymmetric standard is used. ISO/IEC 15420 / GS1
 * (verified against bwip-js/BWIPP): EAN-13 11X (left) / 7X (right) → 11, EAN-8
 * 7X, UPC-A 9X, UPC-E 9X/7X → 9, EAN-5 12X/5X → 12, EAN-2 12X/5X → 12, ITF-14
 * 10X. The `pharmacode` entries have no published numeric margin and are an
 * **unverified safe linear default** of 10X.
 * Code128/Code39/Code93/Codabar/ITF fall through to the 10X fallback in
 * `barcodeQuietModules`.
 */
const BARCODE_QUIET_MODULES: Readonly<Partial<Record<BarcodeSymbology, number>>> = {
    ean13: 11,
    ean8: 7,
    upca: 9,
    upce: 9,
    itf14: 10,
    ean5: 12,
    ean2: 12,
    pharmacode: 10,
    pharmacode2: 10,
};

/** Quiet-zone width (modules/side) for a 1D symbology; fallback 10X. */
export const barcodeQuietModules = (symbology: BarcodeSymbology): number =>
    BARCODE_QUIET_MODULES[symbology] ?? DEFAULT_BARCODE_QUIET_MODULES;

export const QR_ERROR_CORRECTIONS = ['L', 'M', 'Q', 'H'] as const;
export type QrErrorCorrection = (typeof QR_ERROR_CORRECTIONS)[number];
export const DEFAULT_QR_ERROR_CORRECTION: QrErrorCorrection = 'M';

/**
 * Static shape style defaults (#8). Single source of truth for both the resolver
 * (which applies them when a node omits the field) and the insert factory (which
 * seeds them explicitly so the inspector shows a real value).
 *
 * "No fill" is the explicit string `'transparent'` — a real, round-trippable
 * colour the inspector and both renderers agree on — not an absent field. Every
 * shape strokes `#374151` at `50` hm (0.5 mm). Colours are plain strings in
 * `ColorPicker`'s emitted format (`#rrggbb`/`#rrggbbaa`/hex or `transparent`),
 * so a round-trip through the inspector is stable.
 */
/** The no-paint colour: deposits no ink as either a fill or a stroke. */
export const TRANSPARENT_COLOR = 'transparent';
export const DEFAULT_SHAPE_FILL = TRANSPARENT_COLOR;
export const DEFAULT_SHAPE_STROKE = '#374151';
export const DEFAULT_SHAPE_STROKE_WIDTH = 50;

/**
 * True when a fill colour deposits ink. The single source of the no-fill rule
 * for the render path: `'transparent'`, an absent fill, or an empty string all
 * deposit nothing (Konva reads `''` as no fill too — `!!this.fill()`). Note the
 * inspector does **not** share this predicate; it uses `colorDefault`.
 */
export const hasFill = (fill: string | undefined): boolean =>
    !!fill && fill !== DEFAULT_SHAPE_FILL;

/**
 * True when a stroke colour deposits ink. Symmetric with {@link hasFill}: an
 * explicit `'transparent'` (or an absent/empty) stroke paints nothing, so the
 * mask must not claim an outline band the raster leaves white (M2:
 * mask-topmost == raster-topmost). The default `#374151` stroke is real ink.
 */
export const hasStroke = (stroke: string | undefined): boolean =>
    !!stroke && stroke !== TRANSPARENT_COLOR;

/**
 * True for a shape whose outline encloses an area (rectangle / ellipse, or a
 * line/polygon whose `closed` flag is set — a polygon defaults to closed). The
 * single source of the closed-ness rule, reused by `resolve`.
 */
export const isClosedShape = (shape: ShapeKind, closed?: boolean): boolean =>
    shape === 'rectangle' || shape === 'ellipse' || (closed ?? shape === 'polygon');

import type { hm } from '../hm';
import type { QuantizerId } from '../render/quantize';
import type { BarcodeSymbology, ImageFit, QrErrorCorrection, TextWrap } from './objects';

/**
 * LabelDoc v1 — the document contract.
 *
 * Copied from `agent/2026-09-29_label-editor-v1/plan.md` §Data model. The only
 * edits are the ones TypeScript forces:
 *   - `hm` is imported from `../hm` instead of redeclared (P1 owns the type), and
 *   - the plan's `dpi: number = 300` initializer (which interfaces cannot carry)
 *     is written as `dpi: number` with the default documented in a comment.
 * Node type-specific fields are added as minimal interfaces + a `Node` union so
 * `LabelDoc.nodes` is discriminated; the plan elides those fields intentionally.
 */

export type Region =
    | { kind: 'rect'; x: hm; y: hm; w: hm; h: hm }
    | { kind: 'roundedRect'; x: hm; y: hm; w: hm; h: hm; r: hm }
    | { kind: 'circle'; cx: hm; cy: hm; r: hm }
    | { kind: 'polygon'; points: [hm, hm][]; closed: boolean };

export type NodeType = 'group' | 'text' | 'image' | 'shape' | 'qr' | 'barcode';

/** Local bounding box in hm (integer hundredths of a mm). */
export interface NodeSize {
    w: hm;
    h: hm;
}

export type TextAlign = 'left' | 'center' | 'right';
export type TextDirection = 'ltr' | 'rtl';

export interface BaseNode {
    id: string;
    parentId: string | null; // null = root; array order = z-order
    type: NodeType;
    name?: string;
    visible: boolean;
    locked: boolean;
    transform: { x: hm; y: hm; rotDeg: number; scaleX: number; scaleY: number };
    /**
     * Local bounding box. Present for text / image / shape(rect|ellipse) / qr /
     * barcode; line & polygon carry `points` instead. Optional so documents
     * written before geometry existed remain valid (backward compatible).
     */
    size?: NodeSize;
    /** Stroke width in hm (shapes). Optional; invariant across resize (a handle changes geometry, not line width). */
    strokeWidth?: number;
    /**
     * Optional per-object dither policy. When absent, the node's `type` selects
     * the default quantizer (see `core/render/policy`). Deliberately NOT part of
     * `ContentSource` — it is node data, not content.
     */
    quantizerHint?: QuantizerId;
    /** Per-node quantizer controls. Missing options inherit render-level defaults. */
    quantizerParams?: { threshold?: number; strength?: number };
} // + type-specific fields (text props, shape kind, image resource ref, qr payload…)

/** The composed transform shape. Derived type; never stored on a node. */
export type Transform = BaseNode['transform'];

// Minimal per-type node shapes. The plan leaves "type-specific fields" elided —
// these carry only what the union needs to discriminate plus the one required
// payload per kind. They are not a full editor model.
export type ShapeKind = 'line' | 'rectangle' | 'ellipse' | 'polygon';

export interface GroupNode extends BaseNode {
    type: 'group';
}
export interface TextNode extends BaseNode {
    type: 'text';
    text: ContentSource;
    /**
     * Font size in hm. Optional for backward compatibility; the render path and
     * the validator fall back to `DEFAULT_FONT_SIZE`.
     */
    fontSize?: hm;
    fontFamily?: string;
    fontStyle?: string;
    /** Links to `FontRef.fontId`; `fontFamily` remains the resolved family string. */
    fontId?: string;
    align?: TextAlign;
    letterSpacing?: number;
    lineHeight?: number;
    direction?: TextDirection;
    /**
     * Absent ⇒ {@link DEFAULT_TEXT_WRAP} (`'word'`). `word`=wrap at word,
     * `char`=wrap per character, `clip`=no wrap cut at the box, `shrink`=uniform
     * downscale to fit the box.
     */
    wrap?: TextWrap;
}
export interface ImageNode extends BaseNode {
    type: 'image';
    imageId: string;
    /** Fit within the node box; the resolution cap is derived, never stored. */
    fit?: ImageFit;
}
export interface ShapeNode extends BaseNode {
    type: 'shape';
    shape: ShapeKind;
    /** Rectangle corner radius in hm. */
    cornerRadius?: hm;
    /** Line/polygon vertices in hm. */
    points?: [hm, hm][];
    /** Polygon close flag. */
    closed?: boolean;
    /**
     * Fill colour (#8). Plain string in `ColorPicker`'s emitted format (hex or
     * `transparent`). Absent ⇒ `DEFAULT_SHAPE_FILL` (`'transparent'`, i.e. no
     * fill); the resolver always emits a real string.
     */
    fill?: string;
    /** Outline colour (#8). Same format as `fill`; absent ⇒ `#374151`. */
    stroke?: string;
}
export interface QrNode extends BaseNode {
    type: 'qr';
    data: ContentSource;
    errorCorrection?: QrErrorCorrection;
    /**
     * Symbol background colour (`#rrggbb`/`#rrggbbaa`/hex or `'transparent'`).
     * Absent ⇒ `DEFAULT_SYMBOL_FILL` (opaque white, the symbol background — light
     * modules + quiet zone — is painted solid white). An explicit `'transparent'`
     * opts the light modules + quiet zone to see through; any other colour paints
     * an opaque symbol background (WYSIWYG).
     */
    fill?: string;
    /** Quiet-zone width per side in modules. Absent ⇒ the symbology default (4). */
    quietZone?: number;
}
export interface BarcodeNode extends BaseNode {
    type: 'barcode';
    data: ContentSource;
    symbology?: BarcodeSymbology;
    /** Symbol background colour; see {@link QrNode.fill}. */
    fill?: string;
    /** Quiet-zone width per side in modules. Absent ⇒ the symbology default. */
    quietZone?: number;
}

export type Node = GroupNode | TextNode | ImageNode | ShapeNode | QrNode | BarcodeNode;

export type ContentSource =
    | { kind: 'static'; value: string }
    | { kind: 'csv'; column: string; fallback: string }
    | { kind: 'template'; code: string; fallback: string };

export interface FontRef {
    fontId: string;
    familyName: string;
    name: string; // user-facing, editable
    alt?: string; // free-text "what this was"
    source:
        // non-portable by design → ⚠ badge
        | { kind: 'system'; descriptor: string }
        // sha256 once at import; never re-hash; ⚠ badge if missing
        | { kind: 'imported'; asset: AssetRef; fingerprint?: string };
}

/**
 * A global available to templates as `ctx.globals.<name>`. Discriminated by
 * `kind`:
 *
 *   remote = fetched once per job from `url`; `extract` selects the value;
 *            `expiresAt` is epoch seconds (UTC) and controls cache reuse.
 *   static = a literal `value` defined in the document; never fetched, never
 *            expires (cached as always-valid for the job).
 *
 * The persisted/wire form may omit `kind` for legacy remote specs; validation
 * hydrates the missing discriminator to `'remote'`.
 */
export interface GlobalSpecBase {
    name: string;
}

export interface RemoteGlobalSpec extends GlobalSpecBase {
    kind: 'remote';
    url: string;
    extract: string;
    /** Epoch seconds (UTC); prefetch once per job, deep-clone into template worker. */
    expiresAt: number;
}

export interface StaticGlobalSpec extends GlobalSpecBase {
    kind: 'static';
    /** Plain string; never JSON-parsed. */
    value: string;
}

export type GlobalSpec = RemoteGlobalSpec | StaticGlobalSpec;

/**
 * Binary-ish assets (fonts, images, SVGs, CSVs) all use one reference shape. Any
 * of these provenances is legal in the document; the format supports all from day
 * one.
 *
 *   inline   = data URL — self-contained document
 *   remote   = http(s) URL fetched at load
 *   local    = IDB lookup in the `resources` or `csvs` store (resourceId is the key)
 *   external = not carried by the document at all — the asset travels alongside it
 *
 * `fingerprint` (all kinds): sha256 of the asset bytes. Computed ONCE at import,
 * never re-hashed. Present → verify on load, mismatch = warn.
 */
export type AssetRef =
    | { kind: 'inline'; mediaType: string; dataUrl: string }
    | { kind: 'remote'; mediaType: string; url: string }
    | { kind: 'local'; mediaType: string; resourceId: string; fingerprint?: string }
    | { kind: 'external'; mediaType: string; filename: string; fingerprint?: string };

// Every resource carries a user-facing `name` and optional `alt` ("what this
// was"). Default `name` is auto-filled on import (filename or `image-N`), but
// editable. Renaming never breaks references.
export interface ImageRef {
    imageId: string;
    name: string;
    alt?: string;
    source: AssetRef;
    widthPx: number;
    heightPx: number;
}
export interface CsvRef {
    csvId: string;
    name: string;
    alt?: string;
    source: AssetRef;
}

export interface LabelDoc {
    version: 1;
    meta: {
        id: string;
        name: string;
        createdAt: number; // epoch seconds (UTC)
        updatedAt: number; // epoch seconds (UTC)
        // Cosmetic preview. RASTER ONLY (PNG/WebP/JPG) — never SVG, never HTML,
        // never a data URL that could script. May be stale; never used for
        // measurement or rendering. Validation: raster mime only, ≤ 512 px
        // longest side, ≤ 64 KB decoded — reject otherwise. Auto updates on
        // save/export. Not user overridable.
        thumb?: { mediaType: string; dataUrl: string; at: number };
        /** Originating preset id. Drives non-printing guide derivation. */
        presetId?: string;
    };
    label: {
        backingW: hm;
        backingH: hm;
        dpi: number; // default 300; printer-reported; clamp 100–1200
        regions: Region[];
        printDirection: 'top' | 'right' | 'bottom' | 'left';
    };
    nodes: Node[];
    data: { csv?: CsvRef; sampleRowIndex: number; globals: GlobalSpec[] };
    resources: { fonts: FontRef[]; images: ImageRef[] };
}

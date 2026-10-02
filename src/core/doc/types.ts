import type { hm } from '../hm';

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

export interface BaseNode {
    id: string;
    parentId: string | null; // null = root; array order = z-order
    type: NodeType;
    name?: string;
    visible: boolean;
    locked: boolean;
    transform: { x: hm; y: hm; rotDeg: number; scaleX: number; scaleY: number };
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
}
export interface ImageNode extends BaseNode {
    type: 'image';
    imageId: string;
}
export interface ShapeNode extends BaseNode {
    type: 'shape';
    shape: ShapeKind;
}
export interface QrNode extends BaseNode {
    type: 'qr';
    data: ContentSource;
}
export interface BarcodeNode extends BaseNode {
    type: 'barcode';
    data: ContentSource;
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

// expiresAt = epoch seconds (UTC); prefetch once per job, deep-clone into template worker
export interface GlobalSpec {
    name: string;
    url: string;
    extract: string;
    expiresAt: number;
}

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

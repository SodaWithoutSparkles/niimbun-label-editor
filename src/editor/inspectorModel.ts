import type { Node, NodeType } from '../core/doc/types';
import { QUANTIZERS, resolveQuantizer, type QuantizerByType } from '../core/render';
import { BARCODE_SYMBOLOGIES, CODE_FORMATS, IMAGE_FITS, QR_ERROR_CORRECTIONS } from '../core/doc/objects';

/**
 * Typed field model for the MFP **Object** tab. Data only — no store, no React,
 * no rendering. The panel maps these descriptors to widgets; this module never
 * names a product string (i18n keys are the UI's job).
 *
 * Two markers matter:
 *   - `wired` — `true` when P3 can actually act on the field; `false` is a
 *     reserved stub the panel renders disabled, with a `reason` naming which
 *     engine owns it (QR/barcode P4, image P5, templating / trust P6). Shipping
 *     the field now keeps the panel's shape stable while the engine lands later.
 *   - `scope` — which selection mode the field belongs to. Bulk mode
 *     (`ui-spec.md` §10): same-type selection → the type's shared props; mixed
 *     selection → `UNIVERSAL_FIELDS` only. There is deliberately no per-field
 *     mixed-value display (parked).
 *
 * Geometry/font props are real, optional `LabelDoc` v1 node fields (`size`,
 * `fontSize`, `points`, `cornerRadius`, `strokeWidth`); the descriptors below
 * are the formal names the panel edits. Per-type descriptors stay split by scope
 * so a shape and a text node never advertise each other's props.
 */

export type FieldScope =
    | 'transform'
    | 'universal'
    | 'text'
    | 'shape'
    | 'image'
    | 'qr'
    | 'barcode'
    | 'code'
    | 'reserved';

export type FieldKind =
    | 'number'
    | 'string'
    | 'boolean'
    | 'select'
    | 'color'
    /** Editable static content on `node.data` (qr / barcode payload). */
    | 'dataContent'
    /** Select over `doc.resources.images` (options resolved in the panel). */
    | 'imageRef'
    /** Select over `doc.resources.fonts` + import action (options resolved in the panel). */
    | 'fontRef'
    /** Explicit static/csv/template kind switcher for a node's `ContentSource`. */
    | 'contentSource'
    /** Read-only template trust state for the open document. */
    | 'templateTrust'
    | 'stub';

/**
 * Curated system-font families offered by the Object tab's system-font picker.
 * These are ubiquitous platform families (or the generic CSS fallbacks); the
 * picker only sets `fontFamily`, never a `fontId`.
 */
export const SYSTEM_FONTS: readonly string[] = [
    'sans-serif',
    'serif',
    'monospace',
    'Arial',
    'Helvetica',
    'Verdana',
    'Georgia',
    'Times New Roman',
    'Courier New',
];

/**
 * Why a `wired: false` field is disabled, so the panel can show the *right*
 * reason instead of one blanket message. `null` for wired fields.
 */
export type FieldReason = 'trust' | 'image' | 'qr' | 'barcode' | 'content' | 'style';

export interface FieldDescriptor {
    /** Stable field id — the node prop it edits, or a reserved key. */
    key: string;
    scope: FieldScope;
    kind: FieldKind;
    /** `false` = reserved/disabled stub; the panel must not wire it yet. */
    wired: boolean;
    /** Allowed values for `kind: 'select'`. */
    options?: readonly string[];
    /** Why the field is disabled. Required only when `wired: false`. */
    reason?: FieldReason;
}

/** Per-node transform (`PopoverSlider` fields in the Object tab). */
export const TRANSFORM_FIELDS: readonly FieldDescriptor[] = [
    { key: 'x', scope: 'transform', kind: 'number', wired: true },
    { key: 'y', scope: 'transform', kind: 'number', wired: true },
    { key: 'sizeW', scope: 'transform', kind: 'number', wired: true },
    { key: 'sizeH', scope: 'transform', kind: 'number', wired: true },
    { key: 'rotDeg', scope: 'transform', kind: 'number', wired: true },
    { key: 'scaleX', scope: 'transform', kind: 'number', wired: true },
    { key: 'scaleY', scope: 'transform', kind: 'number', wired: true },
];

/** Transform fields with no size box — groups carry no resizable geometry. */
export const GROUP_TRANSFORM_FIELDS: readonly FieldDescriptor[] = TRANSFORM_FIELDS.filter(
    (field) => field.key !== 'sizeW' && field.key !== 'sizeH',
);

/**
 * Props shared by every node type — the only fields shown for a **mixed**
 * multi-selection (`ui-spec.md` §10). `visible`/`locked` are deliberately NOT
 * here: the layers panel owns visibility and lock (ui-spec §7), and the Object
 * tab must not duplicate them. Text alignment now lives on the toolbar icons
 * (ViewControls), so a mixed selection exposes no field of its own.
 */
export const UNIVERSAL_FIELDS: readonly FieldDescriptor[] = [];

export const TEXT_FIELDS: readonly FieldDescriptor[] = [
    // A `fontId` links to a `FontRef`; selecting one also resolves `fontFamily`.
    // The options come from `doc.resources.fonts`, resolved by the panel.
    { key: 'fontId', scope: 'text', kind: 'fontRef', wired: true },
    // System-font picker: sets `fontFamily` from the curated family list.
    { key: 'fontFamily', scope: 'text', kind: 'select', wired: true, options: SYSTEM_FONTS },
    { key: 'fontSize', scope: 'text', kind: 'number', wired: true },
    // Bold/italic and text content are edited inline (ViewControls toggles /
    // WYSIWYG in place), so they no longer appear as Object-tab fields.
    // How the text fills its box (P5): both renderers read `node.wrap`.
    { key: 'wrap', scope: 'text', kind: 'select', wired: true, options: ['word', 'char', 'clip', 'shrink'] },
    { key: 'letterSpacing', scope: 'text', kind: 'number', wired: false, reason: 'style' },
    { key: 'direction', scope: 'text', kind: 'select', wired: false, options: ['ltr', 'rtl'], reason: 'style' },
];

export const SHAPE_FIELDS: readonly FieldDescriptor[] = [
    { key: 'shape', scope: 'shape', kind: 'select', wired: true, options: ['line', 'rectangle', 'ellipse', 'polygon'] },
    // Point editing (vertex handles) ships with the shape tool later; the raw
    // `points` cloud is not edited here yet. Not a CSV/content binding.
    { key: 'points', scope: 'shape', kind: 'stub', wired: false, reason: 'style' },
    { key: 'closed', scope: 'shape', kind: 'boolean', wired: true },
    // Rectangle corner radius: persisted, scaled on resize, and honoured by both
    // renderers (`Konva.Rect.cornerRadius`).
    { key: 'cornerRadius', scope: 'shape', kind: 'number', wired: true },
    // Real static style (#8): the resolver defaults these and both renderers
    // read them, so the fields are wired.
    { key: 'stroke', scope: 'shape', kind: 'color', wired: true },
    { key: 'fill', scope: 'shape', kind: 'color', wired: true },
    { key: 'strokeWidth', scope: 'shape', kind: 'number', wired: true },
];



/**
 * Image fields (P5). `imageId` selects a `doc.resources.images` entry (options
 * resolved by the panel); `fit` chooses the draw policy. The resolution cap is
 * derived by the render path, so there is no editable `resolution` field.
 */
export const IMAGE_FIELDS: readonly FieldDescriptor[] = [
    { key: 'imageId', scope: 'image', kind: 'imageRef', wired: true },
    { key: 'fit', scope: 'image', kind: 'select', wired: true, options: IMAGE_FITS },
];

/** QR fields (P5). `data` is the static payload; `errorCorrection` the EC level. */
export const QR_FIELDS: readonly FieldDescriptor[] = [
    { key: 'data', scope: 'qr', kind: 'dataContent', wired: true },
    { key: 'errorCorrection', scope: 'qr', kind: 'select', wired: true, options: QR_ERROR_CORRECTIONS },
    // Symbol background + quiet zone (P2): resolved by the render path, so wired.
    { key: 'fill', scope: 'qr', kind: 'color', wired: true },
    { key: 'quietZone', scope: 'qr', kind: 'number', wired: true },
];

/** Barcode fields (P5). `data` is the static payload; `symbology` the bcid. */
export const BARCODE_FIELDS: readonly FieldDescriptor[] = [
    { key: 'data', scope: 'barcode', kind: 'dataContent', wired: true },
    { key: 'symbology', scope: 'barcode', kind: 'select', wired: true, options: BARCODE_SYMBOLOGIES },
    // Symbol background + quiet zone (P2): resolved by the render path, so wired.
    { key: 'fill', scope: 'barcode', kind: 'color', wired: true },
    { key: 'quietZone', scope: 'barcode', kind: 'number', wired: true },
];

/** 2D-code fields (P11). `data` is the static payload; `format` the 2D bcid. */
export const CODE_FIELDS: readonly FieldDescriptor[] = [
    { key: 'data', scope: 'code', kind: 'dataContent', wired: true },
    { key: 'format', scope: 'code', kind: 'select', wired: true, options: CODE_FORMATS },
    // Symbol background + quiet zone: resolved by the render path, so wired.
    { key: 'fill', scope: 'code', kind: 'color', wired: true },
    { key: 'quietZone', scope: 'code', kind: 'number', wired: true },
];

/**
 * Per-object dither policies offered by `quantizerHint`. The empty value is the
 * explicit "default" (absent) choice; the node's `type` then picks the policy.
 * Order comes from the `QUANTIZERS` registry (single source of truth).
 */
export const QUANTIZER_HINT_OPTIONS: readonly string[] = ['', ...Object.keys(QUANTIZERS)];

/**
 * Which per-node quantizer controls a node's **effective** strategy exposes:
 *   - `'threshold'` — only the threshold knob (strength/serpentine do nothing
 *     for a point threshold — D-57(c));
 *   - `'diffusion'` — the diffusion knobs (Error diffusion + Serpentine scan);
 *   - `'hidden'` — no effective quantizer, so every knob is inert.
 * Resolution is hint → per-type default (`byType`) → module constant, matching
 * the render path, so a per-type setting can reveal or hide the knobs.
 */
export type QuantizerParamVisibility = 'threshold' | 'diffusion' | 'hidden';

export const quantizerParamVisibility = (
    node: Node,
    byType?: QuantizerByType,
): QuantizerParamVisibility => {
    const id = resolveQuantizer(node, byType);
    if (id === undefined) return 'hidden';
    return id === 'threshold' ? 'threshold' : 'diffusion';
};

/**
 * Extra fields whose owning engine ships later, plus the wired per-object
 * quantizer policy. Kept in one list so the Object tab has a stable shape.
 *   - `contentSource`  — static/csv/template kind switcher, wired (P6)
 *   - `quantizerHint`  — per-object dither policy, wired (P4)
 *   - `templateTrust`  — read-only trust state, wired (P6)
 */
export const RESERVED_FIELDS: readonly FieldDescriptor[] = [
    // Explicit static/csv/template switch: the ONLY place a source is rewritten.
    { key: 'contentSource', scope: 'reserved', kind: 'contentSource', wired: true, options: ['static', 'csv', 'template'] },
    // Per-object dither policy: absent ⇒ the node type's default policy.
    { key: 'quantizerHint', scope: 'reserved', kind: 'select', wired: true, options: QUANTIZER_HINT_OPTIONS },
    { key: 'quantizerThreshold', scope: 'reserved', kind: 'number', wired: true },
    { key: 'quantizerStrength', scope: 'reserved', kind: 'number', wired: true },
    // Per-node serpentine scan. A `select` (not a boolean) reuses the `''`-means-
    // auto convention: `''` ⇒ no per-node value (the strategy's settings default
    // applies — never a pinned `true`), `on`/`off` ⇒ an explicit boolean.
    { key: 'quantizerSerpentine', scope: 'reserved', kind: 'select', wired: true, options: ['', 'on', 'off'] },
    // Per-node tone-curve gamma. Applies to every strategy (for `threshold` it
    // only moves the binarisation cutoff), so it is not gated to one visibility class.
    { key: 'quantizerGamma', scope: 'reserved', kind: 'number', wired: true },
    // Read-only template trust state for the open document.
    { key: 'templateTrust', scope: 'reserved', kind: 'templateTrust', wired: true },
];

/** Type-specific fields, keyed by node type. Groups carry none. */
export const TYPE_FIELDS: Record<NodeType, readonly FieldDescriptor[]> = {
    group: [],
    text: TEXT_FIELDS,
    image: IMAGE_FIELDS,
    shape: SHAPE_FIELDS,
    qr: QR_FIELDS,
    barcode: BARCODE_FIELDS,
    code: CODE_FIELDS,
};

/** Keep the first descriptor for each `key`, preserving order. */
const dedupeByKey = (fields: readonly FieldDescriptor[]): FieldDescriptor[] => {
    const seen = new Set<string>();
    const out: FieldDescriptor[] = [];
    for (const field of fields) {
        if (seen.has(field.key)) continue;
        seen.add(field.key);
        out.push(field);
    }
    return out;
};

/** Type-specific fields for one node type. */
export const typeFields = (type: NodeType): readonly FieldDescriptor[] => TYPE_FIELDS[type];

/**
 * Full single-selection field set for a node type: transform + type props +
 * universal + reserved. Duplicate keys (e.g. `align`) collapse to one.
 */
export const fieldsForNodeType = (type: NodeType): FieldDescriptor[] =>
    dedupeByKey([
        ...(type === 'group' ? GROUP_TRANSFORM_FIELDS : TRANSFORM_FIELDS),
        ...TYPE_FIELDS[type],
        ...UNIVERSAL_FIELDS,
        ...(type === 'group' ? [] : RESERVED_FIELDS),
    ]);

export type BulkMode = 'single' | 'same-type' | 'mixed';

export interface BulkFieldModel {
    mode: BulkMode;
    /** Distinct node types in the selection, in first-seen order. */
    types: NodeType[];
    fields: FieldDescriptor[];
}

/**
 * Object-tab field model for a selection.
 *
 * - none selected  → `single`, no fields
 * - one selected   → `single`, that node's full field set
 * - all same type  → `same-type`, transform + that type's shared props + universal
 * - mixed types    → `mixed`, universal props only
 */
export const bulkFieldModel = (selected: readonly Node[]): BulkFieldModel => {
    const types: NodeType[] = [];
    for (const node of selected) {
        if (!types.includes(node.type)) types.push(node.type);
    }

    if (selected.length <= 1) {
        return {
            mode: 'single',
            types,
            fields: selected.length === 1 ? fieldsForNodeType(selected[0]!.type) : [],
        };
    }

    if (types.length === 1) {
        const type = types[0]!;
        return {
            mode: 'same-type',
            types,
            fields: dedupeByKey([
                ...(type === 'group' ? GROUP_TRANSFORM_FIELDS : TRANSFORM_FIELDS),
                ...TYPE_FIELDS[type],
                ...UNIVERSAL_FIELDS,
            ]),
        };
    }

    return { mode: 'mixed', types, fields: [...UNIVERSAL_FIELDS] };
};

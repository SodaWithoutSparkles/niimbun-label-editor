import type { Node, NodeType } from '../core/doc/types';

/**
 * Typed field model for the MFP **Object** tab. Data only — no store, no React,
 * no rendering. The panel maps these descriptors to widgets; this module never
 * names a product string (i18n keys are the UI's job).
 *
 * Two markers matter:
 *   - `wired` — `true` when P3 can actually act on the field; `false` is a
 *     reserved stub the panel renders disabled, with a `reason` naming which
 *     engine owns it (P4 quantizer/QR/barcode, P5 image, P6 templating /
 *     trust). Shipping the field now keeps the panel's shape stable while the
 *     engine lands later.
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
    | 'reserved';

export type FieldKind =
    | 'number'
    | 'string'
    | 'boolean'
    | 'select'
    | 'color'
    | 'textContent'
    | 'contentSource'
    | 'stub';

/**
 * Why a `wired: false` field is disabled, so the panel can show the *right*
 * reason instead of one blanket message. `null` for wired fields.
 */
export type FieldReason = 'quantizer' | 'trust' | 'image' | 'qr' | 'barcode' | 'content';

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
 * tab must not duplicate them. `align` is universal even though it is also a
 * text prop, so mixed selections can still align.
 */
export const UNIVERSAL_FIELDS: readonly FieldDescriptor[] = [
    { key: 'align', scope: 'universal', kind: 'select', wired: true, options: ['left', 'center', 'right'] },
];

export const TEXT_FIELDS: readonly FieldDescriptor[] = [
    // The leaf's editable static content. Backed by `text: { kind: 'static',
    // value }`; CSV/template execution is P6, so only the static value is
    // editable here.
    { key: 'text', scope: 'text', kind: 'textContent', wired: true },
    // `size` is a `{w, h}` box, not a scalar; the Object tab edits it as the two
    // numeric `sizeW`/`sizeH` transform fields, so this aggregate stays a stub.
    { key: 'size', scope: 'text', kind: 'stub', wired: false, reason: 'content' },
    { key: 'fontFamily', scope: 'text', kind: 'string', wired: true },
    { key: 'fontSize', scope: 'text', kind: 'number', wired: true },
    // The renderer reads `fontStyle` but ignores weight/spacing/direction, so
    // advertising them as wired would let a user edit a field nothing acts on.
    { key: 'fontWeight', scope: 'text', kind: 'select', wired: false, options: ['normal', 'bold'], reason: 'content' },
    { key: 'fontStyle', scope: 'text', kind: 'select', wired: true, options: ['normal', 'italic'] },
    { key: 'align', scope: 'text', kind: 'select', wired: true, options: ['left', 'center', 'right'] },
    { key: 'letterSpacing', scope: 'text', kind: 'number', wired: false, reason: 'content' },
    { key: 'direction', scope: 'text', kind: 'select', wired: false, options: ['ltr', 'rtl'], reason: 'content' },
];

export const SHAPE_FIELDS: readonly FieldDescriptor[] = [
    { key: 'shape', scope: 'shape', kind: 'select', wired: true, options: ['line', 'rectangle', 'ellipse', 'polygon'] },
    // `size` is a `{w, h}` box (see TEXT_FIELDS); edited via sizeW/sizeH.
    { key: 'size', scope: 'shape', kind: 'stub', wired: false, reason: 'content' },
    { key: 'points', scope: 'shape', kind: 'stub', wired: false, reason: 'content' },
    { key: 'closed', scope: 'shape', kind: 'boolean', wired: true },
    // The resolver draws rectangles without a corner radius, so this is a stub
    // until the shape renderer honours it (#13).
    { key: 'cornerRadius', scope: 'shape', kind: 'number', wired: false, reason: 'content' },
    // The resolver draws shapes with fixed stroke/fill constants and never reads
    // these node props, so they are honestly unwired until the renderer honours
    // them (P4/P5 style pass).
    { key: 'stroke', scope: 'shape', kind: 'color', wired: false, reason: 'content' },
    { key: 'fill', scope: 'shape', kind: 'color', wired: false, reason: 'content' },
    { key: 'strokeWidth', scope: 'shape', kind: 'number', wired: false, reason: 'content' },
];



/** Image engine is P5 — typed stubs, all disabled. */
export const IMAGE_FIELDS: readonly FieldDescriptor[] = [
    { key: 'imageId', scope: 'image', kind: 'stub', wired: false, reason: 'image' },
    { key: 'resolution', scope: 'image', kind: 'stub', wired: false, reason: 'image' },
    { key: 'fit', scope: 'image', kind: 'stub', wired: false, reason: 'image' },
];

/** QR engine is P4 — typed stubs, all disabled. */
export const QR_FIELDS: readonly FieldDescriptor[] = [
    { key: 'data', scope: 'qr', kind: 'contentSource', wired: false, reason: 'qr' },
    { key: 'errorCorrection', scope: 'qr', kind: 'stub', wired: false, reason: 'qr' },
    { key: 'size', scope: 'qr', kind: 'stub', wired: false, reason: 'qr' },
];

/** Barcode engine is P4 — typed stubs, all disabled. */
export const BARCODE_FIELDS: readonly FieldDescriptor[] = [
    { key: 'data', scope: 'barcode', kind: 'contentSource', wired: false, reason: 'barcode' },
    { key: 'symbology', scope: 'barcode', kind: 'stub', wired: false, reason: 'barcode' },
    { key: 'size', scope: 'barcode', kind: 'stub', wired: false, reason: 'barcode' },
];

/**
 * Reserved fields whose engine ships later. Present so the Object tab has a
 * stable shape; every entry is `wired: false` and must render disabled.
 *   - `contentSource`  — static is P3, CSV/template execution is P6
 *   - `quantizerHint`  — policy is P4
 *   - `templateTrust`  — trust store is P6
 */
export const RESERVED_FIELDS: readonly FieldDescriptor[] = [
    // Content-source switching (CSV/template) ships with templating in P6.
    { key: 'contentSource', scope: 'reserved', kind: 'contentSource', wired: false, reason: 'content' },
    // Quantizer policy is P4.
    { key: 'quantizerHint', scope: 'reserved', kind: 'stub', wired: false, reason: 'quantizer' },
    // Template trust store is P6.
    { key: 'templateTrust', scope: 'reserved', kind: 'stub', wired: false, reason: 'trust' },
];

/** Type-specific fields, keyed by node type. Groups carry none. */
export const TYPE_FIELDS: Record<NodeType, readonly FieldDescriptor[]> = {
    group: [],
    text: TEXT_FIELDS,
    image: IMAGE_FIELDS,
    shape: SHAPE_FIELDS,
    qr: QR_FIELDS,
    barcode: BARCODE_FIELDS,
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
 * - mixed types    → `mixed`, universal props only (visible / lock / align)
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

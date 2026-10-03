import type { Node, NodeType } from '../core/doc/types';

/**
 * Typed field model for the MFP **Object** tab. Data only — no store, no React,
 * no rendering. The panel maps these descriptors to widgets; this module never
 * names a product string (i18n keys are the UI's job).
 *
 * Two markers matter:
 *   - `wired` — `true` when P3 can actually act on the field; `false` is a
 *     reserved stub the panel renders disabled (P4 quantizer, P6 templating /
 *     trust). Shipping the field now keeps the panel's shape stable while the
 *     engine lands later.
 *   - `scope` — which selection mode the field belongs to. Bulk mode
 *     (`ui-spec.md` §10): same-type selection → the type's shared props; mixed
 *     selection → `UNIVERSAL_FIELDS` only. There is deliberately no per-field
 *     mixed-value display (parked).
 *
 * Geometry/font props are read by the render path as optional node extras
 * (`resolve.ts` `NodeGeometryExtras`) because `LabelDoc` v1 elides them; the
 * descriptors below are the formal names for those fields.
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
    | 'contentSource'
    | 'stub';

export interface FieldDescriptor {
    /** Stable field id — the node prop it edits, or a reserved key. */
    key: string;
    scope: FieldScope;
    kind: FieldKind;
    /** `false` = reserved/disabled stub; the panel must not wire it yet. */
    wired: boolean;
    /** Allowed values for `kind: 'select'`. */
    options?: readonly string[];
}

/** Per-node transform (`PopoverSlider` fields in the Object tab). */
export const TRANSFORM_FIELDS: readonly FieldDescriptor[] = [
    { key: 'x', scope: 'transform', kind: 'number', wired: true },
    { key: 'y', scope: 'transform', kind: 'number', wired: true },
    { key: 'rotDeg', scope: 'transform', kind: 'number', wired: true },
    { key: 'scaleX', scope: 'transform', kind: 'number', wired: true },
    { key: 'scaleY', scope: 'transform', kind: 'number', wired: true },
];

/**
 * Props shared by every node type — the only fields shown for a **mixed**
 * multi-selection (`ui-spec.md` §10). `align` is universal here even though it
 * is also a text prop, so mixed selections can still align.
 */
export const UNIVERSAL_FIELDS: readonly FieldDescriptor[] = [
    { key: 'visible', scope: 'universal', kind: 'boolean', wired: true },
    { key: 'locked', scope: 'universal', kind: 'boolean', wired: true },
    { key: 'align', scope: 'universal', kind: 'select', wired: true, options: ['left', 'center', 'right'] },
];

export const TEXT_FIELDS: readonly FieldDescriptor[] = [
    { key: 'fontFamily', scope: 'text', kind: 'string', wired: true },
    { key: 'fontSize', scope: 'text', kind: 'number', wired: true },
    { key: 'fontWeight', scope: 'text', kind: 'select', wired: true, options: ['normal', 'bold'] },
    { key: 'fontStyle', scope: 'text', kind: 'select', wired: true, options: ['normal', 'italic'] },
    { key: 'align', scope: 'text', kind: 'select', wired: true, options: ['left', 'center', 'right'] },
    { key: 'letterSpacing', scope: 'text', kind: 'number', wired: true },
    { key: 'direction', scope: 'text', kind: 'select', wired: true, options: ['ltr', 'rtl'] },
];

export const SHAPE_FIELDS: readonly FieldDescriptor[] = [
    { key: 'shape', scope: 'shape', kind: 'select', wired: true, options: ['line', 'rectangle', 'ellipse', 'polygon'] },
    { key: 'stroke', scope: 'shape', kind: 'color', wired: true },
    { key: 'fill', scope: 'shape', kind: 'color', wired: true },
    { key: 'strokeWidth', scope: 'shape', kind: 'number', wired: true },
];

/** Image engine is P5 — typed stubs, all disabled. */
export const IMAGE_FIELDS: readonly FieldDescriptor[] = [
    { key: 'imageId', scope: 'image', kind: 'stub', wired: false },
    { key: 'resolution', scope: 'image', kind: 'stub', wired: false },
    { key: 'fit', scope: 'image', kind: 'stub', wired: false },
];

/** QR engine is P4 — typed stubs, all disabled. */
export const QR_FIELDS: readonly FieldDescriptor[] = [
    { key: 'data', scope: 'qr', kind: 'contentSource', wired: false },
    { key: 'errorCorrection', scope: 'qr', kind: 'stub', wired: false },
    { key: 'size', scope: 'qr', kind: 'stub', wired: false },
];

/** Barcode engine is P4 — typed stubs, all disabled. */
export const BARCODE_FIELDS: readonly FieldDescriptor[] = [
    { key: 'data', scope: 'barcode', kind: 'contentSource', wired: false },
    { key: 'symbology', scope: 'barcode', kind: 'stub', wired: false },
    { key: 'size', scope: 'barcode', kind: 'stub', wired: false },
];

/**
 * Reserved fields whose engine ships later. Present so the Object tab has a
 * stable shape; every entry is `wired: false` and must render disabled.
 *   - `contentSource`  — static is P3, CSV/template execution is P6
 *   - `quantizerHint`  — policy is P4
 *   - `templateTrust`  — trust store is P6
 */
export const RESERVED_FIELDS: readonly FieldDescriptor[] = [
    { key: 'contentSource', scope: 'reserved', kind: 'contentSource', wired: false },
    { key: 'quantizerHint', scope: 'reserved', kind: 'stub', wired: false },
    { key: 'templateTrust', scope: 'reserved', kind: 'stub', wired: false },
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
        ...TRANSFORM_FIELDS,
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
            fields: dedupeByKey([...TRANSFORM_FIELDS, ...TYPE_FIELDS[type], ...UNIVERSAL_FIELDS]),
        };
    }

    return { mode: 'mixed', types, fields: [...UNIVERSAL_FIELDS] };
};

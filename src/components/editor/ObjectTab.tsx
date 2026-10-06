import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useStore } from '../../store/useStore';
import { PopoverSlider } from '../common/PopoverSlider';
import { ColorPicker } from '../common/ColorPicker';
import { Input, Select, SettingRow, Toggle } from '../common/forms';
import { bulkFieldModel, type FieldDescriptor, type FieldReason } from '../../editor/inspectorModel';
import { roundHm, type hm } from '../../core/hm';
import { nodeSize, pointsExtent } from '../../core/doc/geometry';
import { effectiveTransform, nodeLookup, IDENTITY_MAT2D, type Mat2D } from '../../core/doc/derive';
import { nodeLocalPoints, transformedBounds } from '../../editor/render/resolve';
import {
    DEFAULT_BARCODE_SYMBOLOGY,
    DEFAULT_IMAGE_FIT,
    DEFAULT_QR_ERROR_CORRECTION,
} from '../../core/doc/objects';
import { fontBadges, type FontBadge } from '../../editor/render/fontAssets';
import { importFontFile } from '../../editor/assetImport';
import type { ContentSource, ImageRef, Node, ShapeKind, ShapeNode } from '../../core/doc/types';
import type { QuantizerId } from '../../core/render';
import type { NodePatch } from '../../store/storeTypes';
import { bytesProviderFor } from './usePreparedAssets';
import { useSampleRowState } from './sampleRowContext';
import { contentSourceOf } from '../../editor/contentSource';
import { ImageImportDialog } from './ImageImportDialog';

/**
 * MFP → Object tab (ui-spec.md §8/§10). Renders the field model from
 * `inspectorModel.bulkFieldModel`: single selection shows the node's full field
 * set, same-type multi-selection shows shared props, mixed shows universal
 * props only. Pure descriptors → widgets; `wired: false` fields render disabled
 * with the reason their owning engine is not yet shipped.
 *.
 * Gesture seam (must-fix #2): number fields edit transiently during a
 * slider/typing gesture and commit **one** undo entry on gesture end, rather
 * than one entry per tick. Non-slider controls commit a single `updateNode`.
 */

interface ObjectTabProps {
    selected: readonly Node[];
}

/**
 * The image import dialog's mode, or `null` when it is closed. `insert`
 * registers a fresh asset and assigns it to the selection; `replace` patches
 * the named existing ref in place (the node keeps its `imageId`). Modelling
 * both as one state makes "insert ⇒ no replace target" structural, so a stale
 * replace id can never leak into an insert.
 */
type ImageDialogState = { mode: 'insert' } | { mode: 'replace'; imageId: string };

const FIELD_LABEL_KEYS = {
    x: 'editor.mfp.field.x',
    y: 'editor.mfp.field.y',
    sizeW: 'editor.mfp.field.sizeW',
    sizeH: 'editor.mfp.field.sizeH',
    size: 'editor.mfp.field.size',
    rotDeg: 'editor.mfp.field.rotDeg',
    scaleX: 'editor.mfp.field.scaleX',
    scaleY: 'editor.mfp.field.scaleY',
    fontFamily: 'editor.mfp.field.fontFamily',
    fontSize: 'editor.mfp.field.fontSize',
    fontWeight: 'editor.mfp.field.fontWeight',
    fontStyle: 'editor.mfp.field.fontStyle',
    align: 'editor.mfp.field.align',
    letterSpacing: 'editor.mfp.field.letterSpacing',
    direction: 'editor.mfp.field.direction',
    shape: 'editor.mfp.field.shape',
    text: 'editor.mfp.field.text',
    points: 'editor.mfp.field.points',
    closed: 'editor.mfp.field.closed',
    cornerRadius: 'editor.mfp.field.cornerRadius',
    stroke: 'editor.mfp.field.stroke',
    fill: 'editor.mfp.field.fill',
    strokeWidth: 'editor.mfp.field.strokeWidth',
    visible: 'editor.mfp.field.visible',
    locked: 'editor.mfp.field.locked',
    imageId: 'editor.mfp.field.imageId',
    fontId: 'editor.mfp.field.fontId',
    resolution: 'editor.mfp.field.resolution',
    fit: 'editor.mfp.field.fit',
    data: 'editor.mfp.field.data',
    errorCorrection: 'editor.mfp.field.errorCorrection',
    symbology: 'editor.mfp.field.symbology',
    contentSource: 'editor.mfp.field.contentSource',
    quantizerHint: 'editor.mfp.field.quantizerHint',
    templateTrust: 'editor.mfp.field.templateTrust',
} as const;

type FieldKey = keyof typeof FIELD_LABEL_KEYS;

const labelFor = (key: string, t: TFunction): string =>
    key in FIELD_LABEL_KEYS ? t(FIELD_LABEL_KEYS[key as FieldKey]) : key;

/** i18n key for a disabled field's reason (what engine owns it). */
const REASON_KEYS: Record<FieldReason, string> = {
    trust: 'editor.mfp.trustDisabled',
    image: 'editor.mfp.imageDisabled',
    qr: 'editor.mfp.qrDisabled',
    barcode: 'editor.mfp.barcodeDisabled',
    content: 'editor.mfp.contentSourceDisabled',
    size: 'editor.mfp.sizeDisabled',
};

/**
 * i18n keys for the `quantizerHint` select. The empty value is the explicit
 * "default" choice (absent ⇒ the node type's default policy).
 */
const QUANTIZER_LABEL_KEYS = {
    '': 'editor.mfp.quantizerOptions.auto',
    threshold: 'editor.mfp.quantizerOptions.threshold',
    floydSteinberg: 'editor.mfp.quantizerOptions.floydSteinberg',
    stucki: 'editor.mfp.quantizerOptions.stucki',
    atkinson: 'editor.mfp.quantizerOptions.atkinson',
} as const satisfies Record<QuantizerId | '', string>;

type QuantizerOption = keyof typeof QUANTIZER_LABEL_KEYS;

const isQuantizerOption = (option: string): option is QuantizerOption =>
    option in QUANTIZER_LABEL_KEYS;

/** i18n keys for the `contentSource` kind switcher (literal map, typed keys). */
const CONTENT_KIND_LABEL_KEYS = {
    static: 'editor.mfp.contentStatic',
    csv: 'editor.mfp.contentCsv',
    template: 'editor.mfp.contentTemplate',
} as const satisfies Record<ContentSource['kind'], string>;

/** i18n keys for the read-only `templateTrust` state (literal map). */
const TRUST_STATE_LABEL_KEYS = {
    ask: 'editor.mfp.trust.ask',
    always: 'editor.mfp.trust.always',
    never: 'editor.mfp.trust.never',
} as const;

/** Human label for one select option. Non-quantizer selects show the raw value. */
const optionLabel = (fieldKey: string, option: string, t: TFunction): string =>
    fieldKey === 'quantizerHint' && isQuantizerOption(option)
        ? t(QUANTIZER_LABEL_KEYS[option])
        : option;

/** The transform keys read straight off `node.transform`. */
const TRANSFORM_KEYS = ['x', 'y', 'rotDeg', 'scaleX', 'scaleY'] as const;
const isTransformKey = (key: string): boolean => (TRANSFORM_KEYS as readonly string[]).includes(key);

/** Resolve a top-level-or-transform numeric prop from the first selected node. */
const numberValue = (node: Node, key: string): number => {
    if (isTransformKey(key)) {
        return node.transform[key as (typeof TRANSFORM_KEYS)[number]];
    }
    if (key === 'sizeW') return node.size?.w ?? 0;
    if (key === 'sizeH') return node.size?.h ?? 0;
    const value = (node as unknown as Record<string, unknown>)[key];
    return typeof value === 'number' ? value : 0;
};

const stringValue = (node: Node, key: string): string => {
    const value = (node as unknown as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : '';
};

const booleanValue = (node: Node, key: string): boolean => {
    if (key === 'visible') return node.visible;
    if (key === 'locked') return node.locked;
    const value = (node as unknown as Record<string, unknown>)[key];
    return value === true;
};

/** Clamp a user-entered size to integer hm ≥ 0 (never NaN / negative). */
export const clampSizeHm = (value: number): hm => (Number.isFinite(value) ? Math.max(0, roundHm(value)) : 0);

/** The `size` box patch for a `sizeW`/`sizeH` edit — two numbers, never a bare scalar. */
export const sizePatch = (node: Node, key: 'sizeW' | 'sizeH', value: number): { size: { w: hm; h: hm } } => {
    const current = { w: node.size?.w ?? 0, h: node.size?.h ?? 0 };
    return key === 'sizeW'
        ? { size: { w: clampSizeHm(value), h: current.h } }
        : { size: { w: current.w, h: clampSizeHm(value) } };
};

const transformPatch = (node: Node, key: string, value: number) => ({
    transform: { ...node.transform, [key]: value },
});

/** The static text of a text node, or `''` for a non-static source. */
export const textContentValue = (node: Node): string =>
    node.type === 'text' && node.text.kind === 'static' ? node.text.value : '';

/**
 * Patch a text node's static content. CSV/template sources are not edited here
 * (execution is P6), so this always writes a `static` source with the new value.
 */
export const textContentPatch = (value: string): NodePatch => ({
    text: { kind: 'static', value },
});

/** The static payload of a qr/barcode node, or `''` for a non-static source. */
export const dataContentValue = (node: Node): string =>
    (node.type === 'qr' || node.type === 'barcode') && node.data.kind === 'static' ? node.data.value : '';

/** Patch a qr/barcode node's static payload (CSV/template execution is P6). */
export const dataContentPatch = (value: string): NodePatch => ({
    data: { kind: 'static', value },
});

/**
 * Patch that switches a text/qr/barcode node's `ContentSource` kind. This is the
 * ONLY path that may rewrite a source to `static`: an edit to the `text`/`data`
 * field of a csv/template node must never silently discard its column/code and
 * fallback (must-fix #1). Switching preserves the previous kind's payload where
 * it maps, and seeds an empty source otherwise.
 */
export const contentKindPatch = (node: Node, kind: ContentSource['kind']): NodePatch => {
    const current = contentSourceOf(node);
    if (current?.kind === kind) return {};
    const field = node.type === 'text' ? 'text' : 'data';
    let next: ContentSource;
    if (kind === 'static') {
        next = { kind: 'static', value: current?.kind === 'static' ? current.value : '' };
    } else if (kind === 'csv') {
        next = { kind: 'csv', column: current?.kind === 'csv' ? current.column : '', fallback: current?.kind === 'csv' ? current.fallback : '' };
    } else {
        next = { kind: 'template', code: current?.kind === 'template' ? current.code : '', fallback: current?.kind === 'template' ? current.fallback : '' };
    }
    return { [field]: next } as NodePatch;
};

/**
 * Patch a text node's system `fontFamily` (the curated picker). Editing the
 * family must keep `fontId` consistent: a linked `FontRef` whose resolved family
 * no longer matches is detached, so the resource select and the displayed family
 * can never disagree. A link that still matches is preserved.
 */
export const fontFamilyPatch = (
    node: Node,
    value: string,
    fonts: readonly { fontId: string; familyName: string }[],
): NodePatch => {
    if (node.type !== 'text') return {};
    const linked = node.fontId ? fonts.find((ref) => ref.fontId === node.fontId) : undefined;
    const keepLink = linked !== undefined && linked.familyName === value;
    return { fontFamily: value, ...(keepLink ? {} : { fontId: undefined }) };
};

/**
 * Effective value shown by an enum select when the node omits the optional
 * field: the render path falls back to these defaults, so the panel mirrors
 * them instead of showing a blank choice.
 */
const FIELD_DEFAULTS: Record<string, string> = {
    errorCorrection: DEFAULT_QR_ERROR_CORRECTION,
    symbology: DEFAULT_BARCODE_SYMBOLOGY,
    fit: DEFAULT_IMAGE_FIT,
    fontFamily: 'sans-serif',
};

/** Badge glyph for a font availability, used beside a font name in the select. */
const badgeGlyph = (badge: FontBadge | undefined): string => (badge === 'imported' ? '✓' : '⚠');

const isPointShape = (kind: ShapeKind): boolean => kind === 'line' || kind === 'polygon';

/**
 * Convert a shape's geometry when its `shape` kind changes (must-fix #5), so the
 * node always has geometry the renderer can draw:
 *   - → line/polygon: seed `points` from the current `size` box (or the existing
 *     point cloud) and drop `size`, since point shapes render from `points`.
 *   - → rectangle/ellipse: drop `points` and seed `size` from the point cloud's
 *     real extent, so a once-point shape still renders a box.
 *   - line ↔ polygon and rectangle ↔ ellipse: no geometry change.
 */
export const shapeKindPatch = (node: ShapeNode, next: ShapeKind): NodePatch => {
    if (node.shape === next) return {};
    const nextIsPoint = isPointShape(next);
    const oldIsPoint = isPointShape(node.shape);
    // Within the point-shape family only the close flag changes; the point
    // cloud is already valid geometry.
    if (nextIsPoint && oldIsPoint) {
        return { shape: next, closed: next === 'polygon' };
    }
    if (nextIsPoint) {
        // → line/polygon from a boxed shape: seed the point cloud from the box
        // and drop `size`, since point shapes render from `points`.
        const box = nodeSize(node);
        const points: [hm, hm][] = [
            [0, 0],
            [box.w, 0],
            [box.w, box.h],
            [0, box.h],
        ];
        return { shape: next, points, closed: next === 'polygon', size: undefined };
    }
    if (oldIsPoint) {
        // → rectangle/ellipse from a point shape: drop `points` and seed `size`
        // from the cloud's real extent, so the box still renders.
        const extent = pointsExtent(node.points ?? []);
        const w = extent.w > 0 ? extent.w : nodeSize(node).w;
        const h = extent.h > 0 ? extent.h : nodeSize(node).h;
        return { shape: next, points: undefined, size: { w: Math.max(1, roundHm(w)), h: Math.max(1, roundHm(h)) } };
    }
    return { shape: next };
};

/** World-space AABB of a node under its effective parent chain. */
export const nodeWorldBounds = (node: Node, byId: ReadonlyMap<string, Node>) =>
    transformedBounds(nodeLocalPoints(node), effectiveTransform(node, byId));

/** Invert only the linear (a,b,c,d) part of a matrix; `null` when singular. */
const invertLinear = (m: Mat2D): Mat2D | null => {
    const det = m.a * m.d - m.b * m.c;
    if (det === 0) return null;
    return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: 0, f: 0 };
};

/** The effective parent matrix (identity at the root). */
const parentMatrix = (node: Node, byId: ReadonlyMap<string, Node>): Mat2D => {
    if (node.parentId === null) return IDENTITY_MAT2D;
    const parent = byId.get(node.parentId);
    return parent ? effectiveTransform(parent, byId) : IDENTITY_MAT2D;
};

/**
 * Patch that aligns a node to a backing edge (must-fix #10). The target is
 * computed from the node's resolved **world** bounds and its real geometry
 * (`nodeLocalPoints`, so line/polygon work too). The resulting world delta is
 * converted into the parent-local space before it is folded into `transform.x/y`,
 * so aligning under a translated/rotated parent does not jump.
 */
export const alignTransformPatch = (
    node: Node,
    byId: ReadonlyMap<string, Node>,
    backingW: number,
    backingH: number,
    edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom',
): NodePatch | null => {
    const bounds = nodeWorldBounds(node, byId);
    let worldDx = 0;
    let worldDy = 0;
    if (edge === 'left') worldDx = -bounds.x;
    else if (edge === 'center') worldDx = Math.round(backingW / 2 - (bounds.x + bounds.w / 2));
    else if (edge === 'right') worldDx = Math.round(backingW - (bounds.x + bounds.w));
    else if (edge === 'top') worldDy = -bounds.y;
    else if (edge === 'middle') worldDy = Math.round(backingH / 2 - (bounds.y + bounds.h / 2));
    else worldDy = Math.round(backingH - (bounds.y + bounds.h));

    const inverse = invertLinear(parentMatrix(node, byId));
    if (!inverse) return null;
    const localDx = inverse.a * worldDx + inverse.c * worldDy;
    const localDy = inverse.b * worldDx + inverse.d * worldDy;
    return {
        transform: {
            ...node.transform,
            x: roundHm(node.transform.x + localDx),
            y: roundHm(node.transform.y + localDy),
        },
    };
};

export const ObjectTab: React.FC<ObjectTabProps> = ({ selected }) => {
    const { t } = useTranslation();
    const updateNode = useStore((state) => state.updateNode);
    const updateNodeTransient = useStore((state) => state.updateNodeTransient);
    const commitDoc = useStore((state) => state.commitDoc);
    const doc = useStore((state) => state.currentDoc);
    const resourceRepo = useStore((state) => state.resourceRepo);
    const addImageRef = useStore((state) => state.addImageRef);
    const addFontRef = useStore((state) => state.addFontRef);
    const updateImageRef = useStore((state) => state.updateImageRef);
    const updateFontRef = useStore((state) => state.updateFontRef);

    const [fontBadgeMap, setFontBadgeMap] = useState<ReadonlyMap<string, FontBadge>>(new Map());
    const [imageDialog, setImageDialog] = useState<ImageDialogState | null>(null);
    const [fontError, setFontError] = useState<string | undefined>(undefined);
    const fontInputRef = useRef<HTMLInputElement>(null);

    const model = useMemo(() => bulkFieldModel(selected), [selected]);
    const first = selected[0];
    const trust = useSampleRowState()?.trust ?? 'ask';

    // A number gesture (slider hold / typing) is bounded by pointer/key end.
    // The baseline is the committed doc; we commit exactly once when the
    // gesture ends. An unmount (tab switch / view change / selection cleared
    // mid-gesture) must COMMIT, not abandon: transient updates have already
    // mutated currentDoc in place, so abandoning would leave a live edit with
    // no undo entry and no autosave — undo would step past it and reload would
    // drop it. `commitDoc` is a no-op when no gesture is pending.
    const gestureRef = useRef(false);
    useEffect(
        () => () => {
            if (gestureRef.current) {
                gestureRef.current = false;
                commitDoc();
            }
        },
        [commitDoc],
    );

    // Font availability badges for the `fontId` select (imported / system /
    // missing). Recompute when the document's resource set changes.
    useEffect(() => {
        if (!doc) {
            setFontBadgeMap(new Map());
            return;
        }
        let cancelled = false;
        const bytes = resourceRepo ? bytesProviderFor(resourceRepo) : { getBytes: async () => null };
        fontBadges(doc, bytes)
            .then((map) => {
                if (!cancelled) setFontBadgeMap(map);
            })
            .catch(() => {
                if (!cancelled) setFontBadgeMap(new Map());
            });
        return () => {
            cancelled = true;
        };
    }, [doc, resourceRepo]);

    const endGesture = () => {
        if (!gestureRef.current) return;
        gestureRef.current = false;
        commitDoc();
    };

    if (selected.length === 0 || !first) {
        return <p className="p-3 text-sm text-gray-500">{t('editor.mfp.noSelection')}</p>;
    }

    /** One committed op for the whole selection (select/toggle/text/color). */
    const commitAll = (patchFor: (node: Node) => Parameters<typeof updateNode>[1]) => {
        for (const node of selected) updateNode(node.id, patchFor(node));
    };

    /**
     * Handle a completed import. In insert mode the new ref is registered and
     * assigned to every selected image node; in replace mode the imported
     * provenance/dimensions patch the existing ref in place, so the node keeps
     * its `imageId`, no orphan ref is created, and the edit is exactly one undo
     * entry.
     */
    const handleImageImported = (ref: ImageRef) => {
        if (imageDialog?.mode === 'replace') {
            updateImageRef(imageDialog.imageId, {
                source: ref.source,
                widthPx: ref.widthPx,
                heightPx: ref.heightPx,
            });
            return;
        }
        addImageRef(ref);
        for (const node of selected) {
            if (node.type === 'image') updateNode(node.id, { imageId: ref.imageId });
        }
    };

    /** Selecting a `FontRef` sets `fontId` and resolves `fontFamily` to its family. */
    const handleFontSelect = (value: string) => {
        const ref = value === '' ? undefined : doc?.resources.fonts.find((font) => font.fontId === value);
        gestureRef.current = true;
        for (const node of selected) {
            if (node.type !== 'text') continue;
            updateNodeTransient(node.id, {
                fontId: value === '' ? undefined : value,
                ...(ref ? { fontFamily: ref.familyName } : {}),
            });
        }
    };

    /** Import a font file: store bytes, register the ref, link the selection. */
    const handleFontFile = async (file: File) => {
        if (!resourceRepo) {
            setFontError(t('editor.mfp.fontImportNeedsStorage'));
            return;
        }
        setFontError(undefined);
        try {
            const { ref } = await importFontFile(file, resourceRepo, {});
            addFontRef(ref);
            for (const node of selected) {
                if (node.type === 'text') updateNode(node.id, { fontId: ref.fontId, fontFamily: ref.familyName });
            }
        } catch (caught) {
            setFontError(caught instanceof Error ? caught.message : String(caught));
        }
    };

    const setNumber = (key: string, value: number) => {
        gestureRef.current = true;
        for (const node of selected) {
            if (isTransformKey(key)) updateNodeTransient(node.id, transformPatch(node, key, value));
            else if (key === 'sizeW' || key === 'sizeH') updateNodeTransient(node.id, sizePatch(node, key, value));
            else updateNodeTransient(node.id, { [key]: value } as never);
        }
    };

    /**
     * String edits — including the `text` textarea — are transient during the
     * gesture and commit exactly **one** undo entry when it ends (must-fix #10).
     * Otherwise the textarea produced one entry per character, which breaks the
     * undo/redo demo.
     */
    const setString = (key: string, value: string) => {
        gestureRef.current = true;
        for (const node of selected) {
            // `shape` is a geometry-bearing change: convert geometry so the node
            // always renders (must-fix #5).
            if (key === 'shape') {
                if (node.type === 'shape') updateNodeTransient(node.id, shapeKindPatch(node, value as ShapeKind));
            } else if (key === 'text') {
                // `text` is a `ContentSource`; only a static source is authored
                // here. A csv/template source is left untouched (execution is
                // P6) so its column/code + fallback survive (must-fix #1).
                if (node.type === 'text' && node.text.kind === 'static') {
                    updateNodeTransient(node.id, textContentPatch(value));
                }
            } else if (key === 'data') {
                // qr / barcode static payload (CSV/template execution is P6).
                if ((node.type === 'qr' || node.type === 'barcode') && node.data.kind === 'static') {
                    updateNodeTransient(node.id, dataContentPatch(value));
                }
            } else if (key === 'fontFamily') {
                // Editing the system family keeps `fontId` consistent (must-fix #2).
                if (node.type === 'text') {
                    updateNodeTransient(node.id, fontFamilyPatch(node, value, doc?.resources.fonts ?? []));
                }
            } else if (key === 'quantizerHint') {
                // The empty option clears the field (absent ⇒ the node type's
                // default policy), so a hint is never stored as an empty string.
                updateNodeTransient(node.id, {
                    quantizerHint: value === '' ? undefined : (value as QuantizerId),
                });
            } else {
                updateNodeTransient(node.id, { [key]: value } as never);
            }
        }
    };

    /** Boolean toggles batch the same way (one entry per gesture). */
    const setBoolean = (key: string, value: boolean) => {
        gestureRef.current = true;
        for (const node of selected) {
            if (key === 'visible') updateNodeTransient(node.id, { visible: value });
            else if (key === 'locked') updateNodeTransient(node.id, { locked: value });
            else updateNodeTransient(node.id, { [key]: value } as never);
        }
    };

    const setColor = (key: string, value: string) => {
        commitAll(() => ({ [key]: value }) as never);
    };

    const disabledReason = (field: FieldDescriptor): string =>
        t(REASON_KEYS[field.reason ?? 'content'] as never);

    const renderField = (field: FieldDescriptor) => {
        const label = labelFor(field.key, t);
        if (!field.wired) {
            return (
                <SettingRow key={field.key} label={label} description={disabledReason(field)}>
                    <input disabled className="w-28 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-500" />
                </SettingRow>
            );
        }
        switch (field.kind) {
            case 'number':
                return (
                    <SettingRow key={field.key} label={label}>
                        <PopoverSlider
                            value={numberValue(first, field.key)}
                            onChange={(value) => setNumber(field.key, value)}
                            min={field.key === 'fontSize' ? 1 : field.key === 'x' || field.key === 'y' ? -10000 : 0}
                            max={field.key === 'fontSize' ? 2000 : 100000}
                            step={1}
                            label={label}
                        />
                    </SettingRow>
                );
            case 'string':
                return (
                    <SettingRow key={field.key} label={label}>
                        <Input value={stringValue(first, field.key)} onChange={(value) => setString(field.key, value)} className="w-40" />
                    </SettingRow>
                );
            case 'textContent':
            case 'dataContent': {
                // Only a `static` source is editable here. A csv/template source
                // renders disabled with the same reason its owning engine is
                // unwired, so an edit can never silently rewrite it to static
                // and discard its column/code + fallback (must-fix #1).
                const isStatic = contentSourceOf(first)?.kind === 'static';
                const value = field.kind === 'textContent' ? textContentValue(first) : dataContentValue(first);
                return (
                    <SettingRow
                        key={field.key}
                        label={label}
                        description={isStatic ? undefined : t('editor.mfp.contentSourceDisabled')}
                    >
                        <textarea
                            aria-label={label}
                            value={value}
                            disabled={!isStatic}
                            onChange={(event) => setString(field.key, event.target.value)}
                            rows={2}
                            className="w-40 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                    </SettingRow>
                );
            }
            case 'boolean':
                return (
                    <SettingRow key={field.key} label={label}>
                        <Toggle checked={booleanValue(first, field.key)} onChange={(value) => setBoolean(field.key, value)} />
                    </SettingRow>
                );
            case 'contentSource': {
                // Explicit kind switch — the only place a source is rewritten.
                // Editing the `text`/`data` field above never changes the kind.
                const current = contentSourceOf(first);
                if (!current) {
                    // No carrier prop to rewrite (e.g. an image/shape); say so
                    // accurately rather than claiming a CSV/template binding.
                    return (
                        <SettingRow key={field.key} label={label} description={t('editor.mfp.contentSourceUnavailable')}>
                            <input disabled className="w-36 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-500" />
                        </SettingRow>
                    );
                }
                // `never` disables authoring a NEW template source; an existing
                // template stays selectable so the user can switch away from it.
                // `ask` still allows authoring (execution is what needs approval).
                const options = (field.options ?? ['static', 'csv', 'template']).filter(
                    (kind) => !(kind === 'template' && trust === 'never' && current.kind !== 'template'),
                );
                return (
                    <SettingRow
                        key={field.key}
                        label={label}
                        description={
                            current.kind === 'template'
                                ? trust === 'never'
                                    ? t('editor.mfp.trustDisabled')
                                    : trust === 'ask'
                                      ? t('editor.mfp.templateNeedsApproval')
                                      : undefined
                                : undefined
                        }
                    >
                        <Select
                            value={current.kind}
                            onChange={(kind) => {
                                for (const node of selected) updateNode(node.id, contentKindPatch(node, kind as ContentSource['kind']));
                            }}
                            options={options.map((kind) => ({
                                value: kind,
                                label: kind in CONTENT_KIND_LABEL_KEYS ? t(CONTENT_KIND_LABEL_KEYS[kind as ContentSource['kind']]) : kind,
                            }))}
                            className="w-36"
                            aria-label={label}
                        />
                    </SettingRow>
                );
            }
            case 'templateTrust':
                return (
                    <SettingRow key={field.key} label={label}>
                        <span
                            aria-label={label}
                            className="rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-200"
                        >
                            {t(TRUST_STATE_LABEL_KEYS[trust])}
                        </span>
                    </SettingRow>
                );
            case 'select': {
                const options = field.options ?? [];
                const raw = stringValue(first, field.key);
                // Absent enum ⇒ the render default; a family resolved by a font
                // selection may not be in the curated list, so keep it selectable.
                const value = raw !== '' ? raw : (FIELD_DEFAULTS[field.key] ?? '');
                const withCurrent = value !== '' && !options.includes(value) ? [value, ...options] : options;
                return (
                    <SettingRow key={field.key} label={label}>
                        <Select
                            value={value}
                            onChange={(next) => setString(field.key, next)}
                            options={withCurrent.map((option) => ({ value: option, label: optionLabel(field.key, option, t) }))}
                            className="w-36"
                        />
                    </SettingRow>
                );
            }
            case 'imageRef': {
                const images = doc?.resources.images ?? [];
                const options = [
                    { value: '', label: t('editor.mfp.none') },
                    ...images.map((ref) => ({ value: ref.imageId, label: ref.name })),
                ];
                return (
                    <SettingRow key={field.key} label={label}>
                        <div className="flex items-center gap-2">
                            <Select
                                value={stringValue(first, field.key)}
                                onChange={(value) => setString(field.key, value)}
                                options={options}
                                className="w-32"
                            />
                            <button
                                type="button"
                                onClick={() => setImageDialog({ mode: 'insert' })}
                                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                            >
                                {t('editor.mfp.importImage')}
                            </button>
                        </div>
                    </SettingRow>
                );
            }
            case 'fontRef': {
                const fonts = doc?.resources.fonts ?? [];
                const options = [
                    { value: '', label: t('editor.mfp.none') },
                    ...fonts.map((ref) => ({
                        value: ref.fontId,
                        label: `${ref.name} ${badgeGlyph(fontBadgeMap.get(ref.fontId))}`,
                    })),
                ];
                return (
                    <SettingRow key={field.key} label={label}>
                        <div className="flex items-center gap-2">
                            <Select
                                value={stringValue(first, field.key)}
                                onChange={handleFontSelect}
                                options={options}
                                className="w-32"
                            />
                            <button
                                type="button"
                                onClick={() => fontInputRef.current?.click()}
                                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                            >
                                {t('editor.mfp.importFont')}
                            </button>
                        </div>
                    </SettingRow>
                );
            }
            case 'color':
                return (
                    <SettingRow key={field.key} label={label}>
                        <ColorPicker color={stringValue(first, field.key) || '#000000'} onChange={(value) => setColor(field.key, value)} supportsAlpha menuAlign="right" />
                    </SettingRow>
                );
            default:
                return (
                    <SettingRow key={field.key} label={label} description={t('editor.mfp.contentSourceDisabled')}>
                        <input disabled className="w-40 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-500" />
                    </SettingRow>
                );
        }
    };

    const align = (edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
        const doc = useStore.getState().currentDoc;
        if (!doc) return;
        const byId = nodeLookup(doc.nodes);
        for (const node of selected) {
            const patch = alignTransformPatch(node, byId, doc.label.backingW, doc.label.backingH, edge);
            if (patch) updateNode(node.id, patch);
        }
    };

    const hasTransform = model.fields.some((field) => field.scope === 'transform');

    // The selected node's referenced asset, if any, for the name/alt rename UI.
    const firstImageRef =
        first.type === 'image' ? doc?.resources.images.find((ref) => ref.imageId === first.imageId) : undefined;
    const firstFontRef =
        first.type === 'text' && first.fontId
            ? doc?.resources.fonts.find((ref) => ref.fontId === first.fontId)
            : undefined;

    return (
        <div
            className="space-y-3 p-3"
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onBlur={endGesture}
        >
            {model.mode !== 'single' && (
                <div className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-400">
                    {model.mode === 'mixed'
                        ? t('editor.mfp.mixedSelection')
                        : t('editor.mfp.bulkTitle', { count: selected.length })}
                </div>
            )}

            {hasTransform && (
                <section>
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                        {t('editor.mfp.transform')}
                    </h4>
                    <div className="space-y-1">
                        {model.fields.filter((field) => field.scope === 'transform').map(renderField)}
                    </div>
                </section>
            )}

            <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {t('editor.mfp.align')}
                </h4>
                <div className="flex flex-wrap gap-1">
                    {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((edge) => (
                        <button
                            key={edge}
                            type="button"
                            onClick={() => align(edge)}
                            title={t(ALIGN_LABEL_KEYS[edge])}
                            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
                        >
                            {t(ALIGN_LABEL_KEYS[edge])}
                        </button>
                    ))}
                </div>
            </section>

            {model.fields
                .filter((field) => field.scope !== 'transform')
                .map(renderField)}

            {(firstImageRef || firstFontRef) && (
                <section>
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                        {t('editor.mfp.asset')}
                    </h4>
                    <AssetRenameFields
                        key={firstImageRef ? `img:${firstImageRef.imageId}` : `font:${firstFontRef!.fontId}`}
                        name={firstImageRef ? firstImageRef.name : firstFontRef!.name}
                        alt={(firstImageRef ? firstImageRef.alt : firstFontRef!.alt) ?? ''}
                        onCommit={(patch) => {
                            if (firstImageRef) updateImageRef(firstImageRef.imageId, patch);
                            else if (firstFontRef) updateFontRef(firstFontRef.fontId, patch);
                        }}
                    />
                    {firstImageRef && (
                        <SettingRow label={t('editor.mfp.field.imageId')}>
                            <button
                                type="button"
                                onClick={() => {
                                    setImageDialog({ mode: 'replace', imageId: firstImageRef.imageId });
                                }}
                                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
                            >
                                {t('editor.mfp.replaceImage')}
                            </button>
                        </SettingRow>
                    )}
                </section>
            )}

            {fontError && <p className="text-xs text-red-400">{fontError}</p>}

            <input
                ref={fontInputRef}
                type="file"
                accept=".woff2,.woff,.ttf,.otf,.ttc,.eot,font/*"
                aria-label={t('editor.mfp.importFont')}
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void handleFontFile(file);
                }}
            />
            <ImageImportDialog
                open={imageDialog !== null}
                variant={imageDialog?.mode === 'replace' ? 'replace' : 'insert'}
                onClose={() => setImageDialog(null)}
                onImported={handleImageImported}
            />
        </div>
    );
};

interface AssetRenameFieldsProps {
    name: string;
    alt: string;
    onCommit: (patch: { name?: string; alt?: string }) => void;
}

/**
 * Editable `name` / `alt` for the selected node's referenced asset. Edits are
 * local drafts committed on blur/Enter, so a rename is exactly one undo entry
 * and a live node reference is never rewritten (the patch is by asset id).
 * Remounts on the asset id (parent `key`), so drafts seed from fresh props.
 */
const AssetRenameFields: React.FC<AssetRenameFieldsProps> = ({ name, alt, onCommit }) => {
    const { t } = useTranslation();
    const [draftName, setDraftName] = useState(name);
    const [draftAlt, setDraftAlt] = useState(alt);

    const commit = () => {
        const patch: { name?: string; alt?: string } = {};
        if (draftName !== name) patch.name = draftName;
        if (draftAlt !== alt) patch.alt = draftAlt === '' ? undefined : draftAlt;
        if (Object.keys(patch).length > 0) onCommit(patch);
    };

    return (
        <>
            <SettingRow label={t('editor.mfp.field.assetName')}>
                <Input
                    value={draftName}
                    onChange={setDraftName}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                    }}
                    aria-label={t('editor.mfp.field.assetName')}
                    className="w-40"
                />
            </SettingRow>
            <SettingRow label={t('editor.mfp.field.alt')}>
                <Input
                    value={draftAlt}
                    onChange={setDraftAlt}
                    onBlur={commit}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                    }}
                    aria-label={t('editor.mfp.field.alt')}
                    className="w-40"
                />
            </SettingRow>
        </>
    );
};

const ALIGN_LABEL_KEYS = {
    left: 'editor.mfp.alignLeft',
    center: 'editor.mfp.alignCenter',
    right: 'editor.mfp.alignRight',
    top: 'editor.mfp.alignTop',
    middle: 'editor.mfp.alignMiddle',
    bottom: 'editor.mfp.alignBottom',
} as const;

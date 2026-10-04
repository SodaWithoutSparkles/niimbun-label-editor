import React, { useEffect, useMemo, useRef } from 'react';
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
import type { Node, ShapeKind, ShapeNode } from '../../core/doc/types';
import type { QuantizerId } from '../../core/render';
import type { NodePatch } from '../../store/storeTypes';

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

    const model = useMemo(() => bulkFieldModel(selected), [selected]);
    const first = selected[0];

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
                // `text` is a `ContentSource`, not a plain prop; write a static
                // source so inserted text can be authored (must-fix #3).
                if (node.type === 'text') updateNodeTransient(node.id, textContentPatch(value));
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
                return (
                    <SettingRow key={field.key} label={label}>
                        <textarea
                            aria-label={label}
                            value={textContentValue(first)}
                            onChange={(event) => setString(field.key, event.target.value)}
                            rows={2}
                            className="w-40 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100"
                        />
                    </SettingRow>
                );
            case 'boolean':
                return (
                    <SettingRow key={field.key} label={label}>
                        <Toggle checked={booleanValue(first, field.key)} onChange={(value) => setBoolean(field.key, value)} />
                    </SettingRow>
                );
            case 'select':
                return (
                    <SettingRow key={field.key} label={label}>
                        <Select
                            value={stringValue(first, field.key)}
                            onChange={(value) => setString(field.key, value)}
                            options={(field.options ?? []).map((option) => ({ value: option, label: optionLabel(field.key, option, t) }))}
                            className="w-36"
                        />
                    </SettingRow>
                );
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
        </div>
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

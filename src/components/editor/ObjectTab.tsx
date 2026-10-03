import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useStore } from '../../store/useStore';
import { PopoverSlider } from '../common/PopoverSlider';
import { ColorPicker } from '../common/ColorPicker';
import { Input, Select, SettingRow, Toggle } from '../common/forms';
import { bulkFieldModel, type FieldDescriptor, type FieldReason } from '../../editor/inspectorModel';
import { roundHm, type hm } from '../../core/hm';
import type { Node } from '../../core/doc/types';

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
    quantizer: 'editor.mfp.quantizerDisabled',
    trust: 'editor.mfp.trustDisabled',
    image: 'editor.mfp.imageDisabled',
    qr: 'editor.mfp.qrDisabled',
    barcode: 'editor.mfp.barcodeDisabled',
    content: 'editor.mfp.contentSourceDisabled',
};

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

    const setString = (key: string, value: string) => {
        commitAll(() => ({ [key]: value }) as never);
    };

    const setBoolean = (key: string, value: boolean) => {
        for (const node of selected) {
            if (key === 'visible') updateNode(node.id, { visible: value });
            else if (key === 'locked') updateNode(node.id, { locked: value });
            else updateNode(node.id, { [key]: value } as never);
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
                            options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
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
        for (const node of selected) {
            const width = node.size?.w ?? 0;
            const height = node.size?.h ?? 0;
            const x = edge === 'left' ? 0 : edge === 'center' ? Math.round(doc.label.backingW / 2 - width / 2) : Math.round(doc.label.backingW - width);
            const y = edge === 'top' ? 0 : edge === 'middle' ? Math.round(doc.label.backingH / 2 - height / 2) : Math.round(doc.label.backingH - height);
            updateNode(node.id, {
                transform: {
                    ...node.transform,
                    ...(edge === 'left' || edge === 'center' || edge === 'right' ? { x } : { y }),
                },
            });
        }
    };

    const hasTransform = model.fields.some((field) => field.scope === 'transform');

    return (
        <div
            className="space-y-3 p-3"
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onKeyUp={endGesture}
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

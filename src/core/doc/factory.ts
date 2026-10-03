import { roundHm, type hm } from '../hm';
import { LABEL_PRESETS, type LabelPresetId } from './label-presets';
import { normalizeDpi } from './validate';
import type { LabelDoc, Node, Region, Transform } from './types';

/** Mint a fresh, globally-unique label id (plan decision 39). */
export const newLabelId = (): string => {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
        return cryptoObj.randomUUID();
    }
    // Fallback for runtimes without `crypto.randomUUID` (older Node, some workers).
    return `lbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const clone = <T>(value: T): T =>
    typeof structuredClone === 'function'
        ? structuredClone(value)
        : (JSON.parse(JSON.stringify(value)) as T);

const DEFAULT_BACKING_W = 4000;
const DEFAULT_BACKING_H = 3000;

/** Integer hm, or 0 when the caller passed a non-finite number. */
const safeRoundHm = (value: number): hm => (Number.isFinite(value) ? roundHm(value) : 0);

/**
 * Round the hm geometry of a caller-supplied region. `createLabelDoc` accepts
 * `regions` from UI code; a float hm would otherwise be persisted verbatim
 * (`"x": 10.5`) while `parseDoc` rounds on read — so the factory must apply the
 * same integer discipline as the validator. Non-finite numeric fields become 0
 * so a structurally valid Region can never serialize as `NaN`/`Infinity`.
 */
const roundRegion = (region: Region): Region => {
    switch (region.kind) {
        case 'rect':
            return { kind: 'rect', x: safeRoundHm(region.x), y: safeRoundHm(region.y), w: safeRoundHm(region.w), h: safeRoundHm(region.h) };
        case 'roundedRect':
            return {
                kind: 'roundedRect',
                x: safeRoundHm(region.x),
                y: safeRoundHm(region.y),
                w: safeRoundHm(region.w),
                h: safeRoundHm(region.h),
                r: safeRoundHm(region.r),
            };
        case 'circle':
            return { kind: 'circle', cx: safeRoundHm(region.cx), cy: safeRoundHm(region.cy), r: safeRoundHm(region.r) };
        case 'polygon':
            return {
                kind: 'polygon',
                points: region.points.map(([x, y]) => [safeRoundHm(x), safeRoundHm(y)]),
                closed: region.closed,
            };
    }
};

/** hm components of a transform are integers; `rotDeg`/`scaleX/Y` stay as-is. */
const roundTransform = (transform: Transform): Transform => ({
    x: safeRoundHm(transform.x),
    y: safeRoundHm(transform.y),
    rotDeg: transform.rotDeg,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
});

/**
 * Round the hm geometry a caller attached to a node: the transform, the optional
 * `size`, `fontSize`, `cornerRadius`, `strokeWidth`, and any `points` vertices.
 * Non-hm numeric props (letterSpacing, lineHeight, rotation, scale) pass through.
 */
export const roundNode = (node: Node): Node => {
    const base = { ...node, transform: roundTransform(node.transform) };
    if (node.size !== undefined) {
        base.size = { w: safeRoundHm(node.size.w), h: safeRoundHm(node.size.h) };
    }
    if (node.strokeWidth !== undefined) base.strokeWidth = safeRoundHm(node.strokeWidth);
    if (node.type === 'text') {
        const rounded = base as typeof node;
        if (node.fontSize !== undefined) rounded.fontSize = Math.max(1, safeRoundHm(node.fontSize));
        return rounded;
    }
    if (node.type === 'shape') {
        const rounded = base as typeof node;
        if (node.cornerRadius !== undefined) rounded.cornerRadius = safeRoundHm(node.cornerRadius);
        if (node.points !== undefined) {
            rounded.points = node.points.map(([x, y]) => [safeRoundHm(x), safeRoundHm(y)]);
        }
        return rounded;
    }
    return base;
};

export interface CreateLabelDocOptions {
    id?: string;
    name?: string;
    preset?: LabelPresetId;
    backingW?: hm;
    backingH?: hm;
    dpi?: number;
    regions?: Region[];
    nodes?: Node[];
    printDirection?: LabelDoc['label']['printDirection'];
    /** Epoch seconds; injectable so tests are deterministic. */
    now?: number;
}

/** Build a valid `LabelDoc` v1. Dates are epoch seconds, never ms. */
export const createLabelDoc = (options: CreateLabelDocOptions = {}): LabelDoc => {
    const preset = options.preset ? LABEL_PRESETS[options.preset] : undefined;
    const now = Math.floor(options.now ?? Date.now() / 1000);

    return {
        version: 1,
        meta: {
            id: options.id ?? newLabelId(),
            name: options.name ?? preset?.name ?? '',
            createdAt: now,
            updatedAt: now,
            ...(preset ? { presetId: preset.id } : {}),
        },
        label: {
            backingW: roundHm(options.backingW ?? preset?.backingW ?? DEFAULT_BACKING_W),
            backingH: roundHm(options.backingH ?? preset?.backingH ?? DEFAULT_BACKING_H),
            dpi: normalizeDpi(options.dpi ?? 300),
            regions: (options.regions ?? preset?.regions.map(clone) ?? []).map((region) =>
                roundRegion(region),
            ),
            printDirection: options.printDirection ?? 'top',
        },
        nodes: (options.nodes ?? []).map(clone).map(roundNode),
        data: { sampleRowIndex: 0, globals: [] },
        resources: { fonts: [], images: [] },
    };
};

export const createFtagSpareDoc = (
    options: Omit<CreateLabelDocOptions, 'preset'> = {},
): LabelDoc => createLabelDoc({ ...options, preset: 'ftagSpare-25x78' });

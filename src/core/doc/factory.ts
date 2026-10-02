import { roundHm, type hm } from '../hm';
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

export type LabelPresetId = 'ftagSpare-25x78';

export interface LabelPreset {
    id: LabelPresetId;
    name: string;
    backingW: hm;
    backingH: hm;
    regions: Region[];
}

/**
 * F-tag spare preset regions (plan §F-tag preset), backing 2500×7800 hm.
 * The label is the **union** of three rounded rectangles:
 *   - `flag`: the full-width upper block (one region, 0..2500 × 0..3800);
 *   - `tail`: the lower-left block (0..1975 × 3400..7800);
 *   - `tab`: the full-height right column (1575..2175 × 0..7800).
 * `regions` is consumed only as `union(regions)` (decision 25), so this is an
 * implementation detail: the union outline is the intended silhouette — a
 * 25×78 backing with the lower-right notch cut out and the tab column printed.
 *
 * The neighbours **overlap** (tail starts at y 3400, before the flag's 3800
 * edge, and is 1975 wide, past the tab's 1575 edge). This is required, not
 * cosmetic: an abutting `roundedRect` pair each rounds its own corner, so where
 * two regions merely touch, each loses the same corner half-disc and the union
 * outline gets a notch punched into it. Overlapping by ≥ 2r covers the seam, so
 * every interior corner that is not meant to be there disappears. The flag was
 * likewise merged from two abutting halves into one region — two halves can
 * never union without a notch at their shared edge.
 *
 * The `flag`/`tail`/`tab` names are descriptive comments only — regions carry
 * no role/id (decision 25).
 */
export const ftagSpareRegions = (): Region[] => [
    // flag: the upper block, one region (splitting it punches a top-edge notch)
    { kind: 'roundedRect', x: 0, y: 0, w: 2500, h: 3800, r: 200 },
    // tail: lower-left block; overlaps the flag and the tab by ≥ 2r
    { kind: 'roundedRect', x: 0, y: 3400, w: 1975, h: 4400, r: 200 },
    // tab: full height, over the flag's right corner and the tail's right edge
    { kind: 'roundedRect', x: 1575, y: 0, w: 600, h: 7800, r: 200 },
];

export const LABEL_PRESETS: Record<LabelPresetId, LabelPreset> = {
    'ftagSpare-25x78': {
        id: 'ftagSpare-25x78',
        name: 'F-tag spare 25×78',
        backingW: 2500,
        backingH: 7800,
        regions: ftagSpareRegions(),
    },
};

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

const roundNode = (node: Node): Node => ({ ...node, transform: roundTransform(node.transform) });

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

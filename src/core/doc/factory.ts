import { roundHm, type hm } from '../hm';
import { GAMMA_MAX, GAMMA_MIN } from '../render/quantize';
import {
    isScreentoneAngle,
    SCREENTONE_BOLDNESS_MAX,
    SCREENTONE_BOLDNESS_MIN,
    SCREENTONE_LEVELS_MAX,
    SCREENTONE_LEVELS_MIN,
    SCREENTONE_PITCH_MM_MAX,
    SCREENTONE_PITCH_MM_MIN,
} from '../render/screentone';
import { PAPER_TYPE_SEEDS } from './paper-types';
import { normalizeDpi } from './validate';
import type { DocKind, Guide, LabelDoc, Node, Region, Transform } from './types';

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

/**
 * Fallback backing size (hm) when neither explicit geometry nor a paper type
 * supplies one. Exported so the create-label dialog's "custom" fallback seeds
 * the same 40×30 mm geometry instead of repeating magic numbers.
 */
export const DEFAULT_BACKING_W = 4000;
export const DEFAULT_BACKING_H = 3000;

/** Integer hm, or 0 when the caller passed a non-finite number. */
const safeRoundHm = (value: number): hm => (Number.isFinite(value) ? roundHm(value) : 0);

/** Integer hm clamped at 0 (matches `validate`/`geometry` negative-size discipline). */
const nonNegativeHm = (value: number): hm => Math.max(0, safeRoundHm(value));

/**
 * Round the hm geometry of a caller-supplied region. `createLabelDoc` accepts
 * `regions` from UI code; a float hm would otherwise be persisted verbatim
 * (`"x": 10.5`) while `parseDoc` rounds on read — so the factory must apply the
 * same integer discipline as the validator. Non-finite numeric fields become 0
 * so a structurally valid Region can never serialize as `NaN`/`Infinity`, and
 * negative `w`/`h`/`r` are clamped to 0 (a negative extent is not renderable and
 * `CreateLabelDialog`'s `min="0"` is only a hint).
 */
const roundRegion = (region: Region): Region => {
    switch (region.kind) {
        case 'rect':
            return { kind: 'rect', x: safeRoundHm(region.x), y: safeRoundHm(region.y), w: nonNegativeHm(region.w), h: nonNegativeHm(region.h) };
        case 'roundedRect':
            return {
                kind: 'roundedRect',
                x: safeRoundHm(region.x),
                y: safeRoundHm(region.y),
                w: nonNegativeHm(region.w),
                h: nonNegativeHm(region.h),
                r: nonNegativeHm(region.r),
            };
        case 'circle':
            return { kind: 'circle', cx: safeRoundHm(region.cx), cy: safeRoundHm(region.cy), r: nonNegativeHm(region.r) };
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
 * Round the hm geometry of a caller-supplied guide. `createLabelDoc` accepts
 * `guides` from UI code (and copies a paper type's), so the four line coordinates go
 * through the same integer discipline as a region's `x`/`y`: a float would
 * otherwise persist verbatim while `parseDoc` rounds on read.
 */
const roundGuide = (guide: Guide): Guide => ({
    ...guide,
    line: {
        x1: safeRoundHm(guide.line.x1),
        y1: safeRoundHm(guide.line.y1),
        x2: safeRoundHm(guide.line.x2),
        y2: safeRoundHm(guide.line.y2),
    },
});

/**
 * Round the hm geometry a caller attached to a node: the transform, the optional
 * `size`, `fontSize`, `cornerRadius`, `strokeWidth`, and any `points` vertices.
 * Non-hm numeric props (letterSpacing, lineHeight, rotation, scale) pass through.
 */
export const roundNode = (node: Node): Node => {
    const base = { ...node, transform: roundTransform(node.transform) };
    if (node.size !== undefined) {
        base.size = { w: nonNegativeHm(node.size.w), h: nonNegativeHm(node.size.h) };
    }
    if (node.strokeWidth !== undefined) base.strokeWidth = nonNegativeHm(node.strokeWidth);
    if (node.quantizerParams) {
        base.quantizerParams = {
            ...(node.quantizerParams.threshold !== undefined && Number.isFinite(node.quantizerParams.threshold)
                ? { threshold: Math.max(0, Math.min(255, Math.round(node.quantizerParams.threshold))) }
                : {}),
            ...(node.quantizerParams.strength !== undefined && Number.isFinite(node.quantizerParams.strength)
                ? { strength: Math.round(Math.max(0, Math.min(4, node.quantizerParams.strength)) * 100) / 100 }
                : {}),
            ...(node.quantizerParams.gamma !== undefined && Number.isFinite(node.quantizerParams.gamma)
                ? {
                      gamma:
                          Math.round(
                              Math.max(GAMMA_MIN, Math.min(GAMMA_MAX, node.quantizerParams.gamma)) * 100,
                          ) / 100,
                  }
                : {}),
            // A boolean needs no rounding; drop only a non-boolean (a caller that
            // bypassed validation), so a valid `serpentine` round-trips verbatim.
            ...(typeof node.quantizerParams.serpentine === 'boolean'
                ? { serpentine: node.quantizerParams.serpentine }
                : {}),
            // Screentone knobs: the same clamp/round discipline as `validate`, so
            // a factory-built node and a parsed import converge on one value.
            ...(node.quantizerParams.screentoneLevels !== undefined &&
            Number.isFinite(node.quantizerParams.screentoneLevels)
                ? {
                      screentoneLevels: Math.max(
                          SCREENTONE_LEVELS_MIN,
                          Math.min(
                              SCREENTONE_LEVELS_MAX,
                              Math.round(node.quantizerParams.screentoneLevels),
                          ),
                      ),
                  }
                : {}),
            ...(node.quantizerParams.screentonePitchMm !== undefined &&
            Number.isFinite(node.quantizerParams.screentonePitchMm)
                ? {
                      screentonePitchMm:
                          Math.round(
                              Math.max(
                                  SCREENTONE_PITCH_MM_MIN,
                                  Math.min(
                                      SCREENTONE_PITCH_MM_MAX,
                                      node.quantizerParams.screentonePitchMm,
                                  ),
                              ) * 100,
                          ) / 100,
                  }
                : {}),
            ...(isScreentoneAngle(node.quantizerParams.screentoneAngle)
                ? { screentoneAngle: node.quantizerParams.screentoneAngle }
                : {}),
            ...(node.quantizerParams.screentoneBoldness !== undefined &&
            Number.isFinite(node.quantizerParams.screentoneBoldness)
                ? {
                      screentoneBoldness:
                          Math.round(
                              Math.max(
                                  SCREENTONE_BOLDNESS_MIN,
                                  Math.min(
                                      SCREENTONE_BOLDNESS_MAX,
                                      node.quantizerParams.screentoneBoldness,
                                  ),
                              ) * 100,
                          ) / 100,
                  }
                : {}),
        };
    }
    // Drop a params object that rounded down to nothing (e.g. `{}` or all-invalid)
    // **before** the per-type early returns, so a text node cannot keep the key.
    if (node.quantizerParams && Object.keys(base.quantizerParams ?? {}).length === 0) {
        delete base.quantizerParams;
    }
    if (node.type === 'text') {
        const rounded = base as typeof node;
        if (node.fontSize !== undefined) rounded.fontSize = Math.max(1, safeRoundHm(node.fontSize));
        return rounded;
    }
    if (node.type === 'shape') {
        const rounded = base as typeof node;
        if (node.cornerRadius !== undefined) rounded.cornerRadius = nonNegativeHm(node.cornerRadius);
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
    paperTypeId?: string;
    /** `'label'` (default) or `'preset'` — see {@link DocKind}. */
    kind?: DocKind;
    backingW?: hm;
    backingH?: hm;
    dpi?: number;
    regions?: Region[];
    guides?: Guide[];
    nodes?: Node[];
    printDirection?: LabelDoc['label']['printDirection'];
    printOffset?: LabelDoc['label']['printOffset'];
    /** Epoch seconds; injectable so tests are deterministic. */
    now?: number;
}

/** Build a valid `LabelDoc` v1. Dates are epoch seconds, never ms. */
export const createLabelDoc = (options: CreateLabelDocOptions = {}): LabelDoc => {
    const preset = options.paperTypeId ? PAPER_TYPE_SEEDS[options.paperTypeId] : undefined;
    const now = Math.floor(options.now ?? Date.now() / 1000);

    return {
        version: 1,
        meta: {
            id: options.id ?? newLabelId(),
            name: options.name ?? preset?.name ?? '',
            createdAt: now,
            updatedAt: now,
            kind: options.kind ?? 'label',
            ...(options.paperTypeId !== undefined ? { paperTypeId: options.paperTypeId } : {}),
        },
        label: {
            backingW: roundHm(options.backingW ?? preset?.backingW ?? DEFAULT_BACKING_W),
            backingH: roundHm(options.backingH ?? preset?.backingH ?? DEFAULT_BACKING_H),
            dpi: normalizeDpi(options.dpi ?? 300),
            regions: (options.regions ?? preset?.regions.map(clone) ?? []).map((region) =>
                roundRegion(region),
            ),
            guides: (options.guides ?? preset?.guides.map(clone) ?? []).map((guide) =>
                roundGuide(guide),
            ),
            printDirection: options.printDirection ?? 'top',
            ...(options.printOffset
                ? {
                      printOffset: {
                          xHm: roundHm(options.printOffset.xHm),
                          yHm: roundHm(options.printOffset.yHm),
                          type: options.printOffset.type,
                      },
                  }
                : {}),
        },
        nodes: (options.nodes ?? []).map(clone).map(roundNode),
        data: { sampleRowIndex: 0, globals: [] },
        resources: { fonts: [], images: [] },
    };
};

export interface CopyLabelDocOptions {
    /** The copy's kind. Explicit — a copy never inherits `source.meta.kind`. */
    kind: DocKind;
    /** Display name; defaults to the source's name. */
    name?: string;
    /** Injectable id (tests); otherwise a fresh `newLabelId()`. */
    id?: string;
    /** Epoch seconds; injectable so tests are deterministic. */
    now?: number;
}

/**
 * Copy a document into a new one, optionally under a different `kind`
 * ("save as preset", and later "open preset in the editor").
 *
 * This is deliberately **not** `createLabelDoc`: that factory's option list
 * carries geometry + nodes but not `data.csv`, `globals` or
 * `resources.{fonts,images}`, so rebuilding a preset through it would silently
 * drop an attached CSV table or an imported font. A deep clone preserves
 * everything; only the identity/activity fields in `meta` are rewritten — fresh
 * id, explicit kind, name (given or inherited), both timestamps = now — and the
 * cosmetic `meta.thumb` is cleared because it depicts the *source* record.
 *
 * Pure: no storage, no React, and the source document is never mutated.
 */
export const copyLabelDoc = (source: LabelDoc, options: CopyLabelDocOptions): LabelDoc => {
    const cloned = clone(source);
    const now = Math.floor(options.now ?? Date.now() / 1000);
    // `thumb` is a cache of the source's pixels; a copy starts without one
    // (the thumbnail hook regenerates it after the first render/save).
    delete cloned.meta.thumb;
    return {
        ...cloned,
        meta: {
            ...cloned.meta,
            id: options.id ?? newLabelId(),
            name: options.name ?? cloned.meta.name,
            createdAt: now,
            updatedAt: now,
            // Explicit, so a label copy can never become a preset by inheritance.
            kind: options.kind,
        },
    };
};

export const createFtagSpareDoc = (
    options: Omit<CreateLabelDocOptions, 'paperTypeId'> = {},
): LabelDoc => createLabelDoc({ ...options, paperTypeId: 'ftagSpare-25x78' });

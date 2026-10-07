import type { hm } from '../hm';
import { QUANTIZERS, type QuantizerId } from '../render/quantize';
import {
    BARCODE_SYMBOLOGIES,
    IMAGE_FITS,
    QR_ERROR_CORRECTIONS,
} from './objects';
import type {
    AssetRef,
    BaseNode,
    CsvRef,
    ContentSource,
    FontRef,
    GlobalSpec,
    ImageNode,
    ImageRef,
    LabelDoc,
    Node,
    NodeType,
    QrNode,
    BarcodeNode,
    Region,
    ShapeKind,
    TextNode,
    Transform,
} from './types';

/**
 * Shape validation + repair for `LabelDoc` v1, mirroring the hand-rolled
 * precedent in `src/store/preferenceValidation.ts` — no schema library.
 *
 * Rules:
 *   - repair what is safely repairable (round hm, clamp dpi, default optionals),
 *   - reject structurally wrong documents with `{ ok: false, errors }`,
 *   - never throw,
 *   - never silently reset to a blank document (the niim.blue anti-pattern),
 *   - `meta.thumb` is a trust boundary: raster-only, size-capped, and a bad
 *     thumb is *stripped*, not allowed to fail the whole document.
 */

export type ValidationResult =
    | { ok: true; doc: LabelDoc; repairs: string[] }
    | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
    isString(value) && (allowed as readonly string[]).includes(value);

/**
 * `ColorPicker` emits `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` hex (with optional
 * alpha) or the literal `transparent` (alpha 0). Accept exactly those so a
 * round-trip through the inspector is stable and no other CSS syntax slips in.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const isColorString = (value: unknown): value is string =>
    isString(value) && (value === 'transparent' || HEX_COLOR.test(value));

const NODE_TYPES: readonly NodeType[] = ['group', 'text', 'image', 'shape', 'qr', 'barcode'];
const SHAPE_KINDS: readonly ShapeKind[] = ['line', 'rectangle', 'ellipse', 'polygon'];
// Derived from the registry so a newly added quantizer is accepted automatically.
const QUANTIZER_IDS = Object.keys(QUANTIZERS) as QuantizerId[];
const PRINT_DIRECTIONS: readonly LabelDoc['label']['printDirection'][] = [
    'top',
    'right',
    'bottom',
    'left',
];

const DPI_MIN = 100;
const DPI_MAX = 1200;
const DPI_DEFAULT = 300;

const TEXT_ALIGNS: readonly NonNullable<TextNode['align']>[] = ['left', 'center', 'right'];
const TEXT_DIRECTIONS: readonly NonNullable<TextNode['direction']>[] = ['ltr', 'rtl'];

/** Integer hundredths of a mm. Floats are coerced to the nearest integer. */
export const isHm = (value: unknown): hm | undefined =>
    isFiniteNumber(value) ? Math.round(value) : undefined;

/** Clamp a dpi to a rounded integer in [100, 1200]; missing/invalid → 300. */
export const normalizeDpi = (value: unknown): number => {
    if (!isFiniteNumber(value)) return DPI_DEFAULT;
    return Math.min(DPI_MAX, Math.max(DPI_MIN, Math.round(value)));
};

/** Clamp a region extent to `≥ 0`, recording a visible repair when it was negative. */
const clampRegionExtent = (value: hm, label: string, repairs?: string[]): hm => {
    if (value >= 0) return value;
    repairs?.push(label);
    return 0;
};

export const isRegion = (value: unknown, repairs?: string[]): Region | undefined => {
    if (!isRecord(value)) return undefined;
    switch (value.kind) {
        case 'rect': {
            const x = isHm(value.x);
            const y = isHm(value.y);
            const w = isHm(value.w);
            const h = isHm(value.h);
            if (x === undefined || y === undefined || w === undefined || h === undefined) {
                return undefined;
            }
            return {
                kind: 'rect',
                x,
                y,
                w: clampRegionExtent(w, 'region.w: negative width clamped to 0', repairs),
                h: clampRegionExtent(h, 'region.h: negative height clamped to 0', repairs),
            };
        }
        case 'roundedRect': {
            const x = isHm(value.x);
            const y = isHm(value.y);
            const w = isHm(value.w);
            const h = isHm(value.h);
            if (x === undefined || y === undefined || w === undefined || h === undefined) {
                return undefined;
            }
            // `r` is required by the type but a missing radius safely defaults to 0.
            const r = isHm(value.r) ?? 0;
            return {
                kind: 'roundedRect',
                x,
                y,
                w: clampRegionExtent(w, 'region.w: negative width clamped to 0', repairs),
                h: clampRegionExtent(h, 'region.h: negative height clamped to 0', repairs),
                r: clampRegionExtent(r, 'region.r: negative radius clamped to 0', repairs),
            };
        }
        case 'circle': {
            const cx = isHm(value.cx);
            const cy = isHm(value.cy);
            const r = isHm(value.r);
            if (cx === undefined || cy === undefined || r === undefined) return undefined;
            return {
                kind: 'circle',
                cx,
                cy,
                r: clampRegionExtent(r, 'region.r: negative radius clamped to 0', repairs),
            };
        }
        case 'polygon': {
            if (!Array.isArray(value.points)) return undefined;
            const points: [hm, hm][] = [];
            for (const point of value.points) {
                if (!Array.isArray(point) || point.length < 2) return undefined;
                const x = isHm(point[0]);
                const y = isHm(point[1]);
                if (x === undefined || y === undefined) return undefined;
                points.push([x, y]);
            }
            if (value.closed !== undefined && typeof value.closed !== 'boolean') {
                repairs?.push('region.polygon.closed: non-boolean closed defaulted to true');
            }
            return { kind: 'polygon', points, closed: value.closed !== false };
        }
        default:
            return undefined;
    }
};

export const isAssetRef = (value: unknown): AssetRef | undefined => {
    if (!isRecord(value) || !isString(value.mediaType)) return undefined;
    const mediaType = value.mediaType;
    switch (value.kind) {
        case 'inline':
            return isString(value.dataUrl)
                ? { kind: 'inline', mediaType, dataUrl: value.dataUrl }
                : undefined;
        case 'remote':
            return isString(value.url)
                ? { kind: 'remote', mediaType, url: value.url }
                : undefined;
        case 'local':
            if (!isString(value.resourceId)) return undefined;
            return {
                kind: 'local',
                mediaType,
                resourceId: value.resourceId,
                ...(isString(value.fingerprint) ? { fingerprint: value.fingerprint } : {}),
            };
        case 'external':
            if (!isString(value.filename)) return undefined;
            return {
                kind: 'external',
                mediaType,
                filename: value.filename,
                ...(isString(value.fingerprint) ? { fingerprint: value.fingerprint } : {}),
            };
        default:
            return undefined;
    }
};

const toContentSource = (value: unknown): ContentSource | undefined => {
    if (isString(value)) return { kind: 'static', value };
    if (!isRecord(value)) return undefined;
    switch (value.kind) {
        case 'static':
            return isString(value.value) ? { kind: 'static', value: value.value } : undefined;
        case 'csv':
            return isString(value.column)
                ? {
                      kind: 'csv',
                      column: value.column,
                      fallback: isString(value.fallback) ? value.fallback : '',
                  }
                : undefined;
        case 'template':
            return isString(value.code)
                ? {
                      kind: 'template',
                      code: value.code,
                      fallback: isString(value.fallback) ? value.fallback : '',
                  }
                : undefined;
        default:
            return undefined;
    }
};

const toTransform = (value: unknown, repairs?: string[]): Transform => {
    const record = isRecord(value) ? value : {};
    if (record.rotDeg !== undefined && !isFiniteNumber(record.rotDeg)) {
        repairs?.push('node.transform.rotDeg: non-finite rotation defaulted to 0');
    }
    if (record.scaleX !== undefined && !isFiniteNumber(record.scaleX)) {
        repairs?.push('node.transform.scaleX: non-finite scale defaulted to 1');
    }
    if (record.scaleY !== undefined && !isFiniteNumber(record.scaleY)) {
        repairs?.push('node.transform.scaleY: non-finite scale defaulted to 1');
    }
    return {
        x: isHm(record.x) ?? 0,
        y: isHm(record.y) ?? 0,
        rotDeg: isFiniteNumber(record.rotDeg) ? record.rotDeg : 0,
        scaleX: isFiniteNumber(record.scaleX) ? record.scaleX : 1,
        scaleY: isFiniteNumber(record.scaleY) ? record.scaleY : 1,
    };
};

/**
 * Optional node size: `{ w, h }` with integer hm and `w/h ≥ 0`. A present but
 * malformed size is dropped (absent) rather than failing the document — the
 * fields are optional/aditive, and older docs simply lack them.
 */
const toNodeSize = (value: unknown, repairs?: string[]): { w: hm; h: hm } | undefined => {
    if (!isRecord(value)) return undefined;
    const w = isHm(value.w);
    const h = isHm(value.h);
    if (w === undefined || h === undefined) return undefined;
    const clamped = { w: Math.max(0, w), h: Math.max(0, h) };
    if (clamped.w !== w || clamped.h !== h) {
        repairs?.push('node.size: negative size clamped to 0');
    }
    return clamped;
};

/** Optional non-negative hm (size / radius / stroke). A bad value is dropped. */
const toOptionalHm = (value: unknown): hm | undefined => {
    if (value === undefined) return undefined;
    const n = isHm(value);
    return n === undefined ? undefined : Math.max(0, n);
};

/** Optional `fontSize`: integer hm, strictly `> 0`; a bad value is dropped. */
const toFontSize = (value: unknown): hm | undefined => {
    if (value === undefined) return undefined;
    const n = isHm(value);
    return n === undefined || n <= 0 ? undefined : n;
};

/**
 * Optional `quantizerHint` enum. An unknown/invalid value is dropped (absent)
 * rather than failing the document — an absent hint means "type default", which
 * is always a safe fallback.
 */
const toQuantizerHint = (value: unknown, repairs?: string[]): QuantizerId | undefined => {
    if (value === undefined) return undefined;
    if (isOneOf(value, QUANTIZER_IDS)) return value;
    repairs?.push('node.quantizerHint: unknown quantizer dropped');
    return undefined;
};

/**
 * Optional string-enum value. A missing (`undefined`) optional returns
 * `undefined` silently; a present-but-invalid value is dropped (absent) and
 * recorded as a repair rather than failing the document — an absent optional
 * always means "use the default", which is a safe fallback.
 */
const toOptionalEnum = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    repairs: string[] | undefined,
    message: string,
): T | undefined => {
    if (value === undefined) return undefined;
    if (isOneOf(value, allowed)) return value;
    repairs?.push(message);
    return undefined;
};

/**
 * Optional colour string. A missing (`undefined`) optional returns `undefined`
 * silently; a present-but-invalid value is dropped (absent) and recorded as a
 * repair rather than failing the document — an absent colour always means "use
 * the render default", which is a safe fallback.
 */
const toOptionalColor = (
    value: unknown,
    repairs: string[] | undefined,
    message: string,
): string | undefined => {
    if (value === undefined) return undefined;
    if (isColorString(value)) return value;
    repairs?.push(message);
    return undefined;
};

export const isNode = (value: unknown, repairs?: string[]): Node | undefined => {
    if (!isRecord(value)) return undefined;
    if (!isString(value.id) || value.id.length === 0) return undefined;
    if (!isOneOf(value.type, NODE_TYPES)) return undefined;

    if (value.parentId !== undefined && value.parentId !== null && !isString(value.parentId)) {
        repairs?.push('node.parentId: non-string parentId re-parented to root');
    }
    if (value.name !== undefined && !isString(value.name)) {
        repairs?.push('node.name: non-string name dropped');
    }

    const base: Omit<BaseNode, 'type'> = {
        id: value.id,
        parentId: isString(value.parentId) ? value.parentId : null,
        ...(isString(value.name) ? { name: value.name } : {}),
        visible: typeof value.visible === 'boolean' ? value.visible : true,
        locked: typeof value.locked === 'boolean' ? value.locked : false,
        transform: toTransform(value.transform, repairs),
    };
    const size = toNodeSize(value.size, repairs);
    if (size !== undefined) base.size = size;
    const strokeWidth = toOptionalHm(value.strokeWidth);
    if (strokeWidth !== undefined) base.strokeWidth = strokeWidth;
    const quantizerHint = toQuantizerHint(value.quantizerHint, repairs);
    if (quantizerHint !== undefined) base.quantizerHint = quantizerHint;
    if (value.quantizerParams !== undefined) {
        if (isRecord(value.quantizerParams)) {
            const raw = value.quantizerParams;
            const params: { threshold?: number; strength?: number } = {};
            if (raw.threshold !== undefined) {
                if (isFiniteNumber(raw.threshold)) params.threshold = Math.max(0, Math.min(255, Math.round(raw.threshold)));
                else repairs?.push('node.quantizerParams.threshold: invalid value dropped');
                if (isFiniteNumber(raw.threshold) && params.threshold !== raw.threshold) {
                    repairs?.push('node.quantizerParams.threshold: clamped to 0–255');
                }
            }
            if (raw.strength !== undefined) {
                if (isFiniteNumber(raw.strength)) params.strength = Math.max(0, Math.min(4, raw.strength));
                else repairs?.push('node.quantizerParams.strength: invalid value dropped');
                if (isFiniteNumber(raw.strength) && params.strength !== raw.strength) {
                    repairs?.push('node.quantizerParams.strength: clamped to 0–4');
                }
            }
            if (Object.keys(params).length) base.quantizerParams = params;
        } else repairs?.push('node.quantizerParams: invalid value dropped');
    }

    switch (value.type) {
        case 'group':
            return { ...base, type: 'group' };
        case 'text': {
            const node: TextNode = {
                ...base,
                type: 'text',
                text: toContentSource(value.text) ?? { kind: 'static', value: '' },
            };
            const fontSize = toFontSize(value.fontSize);
            if (fontSize !== undefined) node.fontSize = fontSize;
            if (isString(value.fontFamily)) node.fontFamily = value.fontFamily;
            if (isString(value.fontStyle)) node.fontStyle = value.fontStyle;
            if (isString(value.fontId)) node.fontId = value.fontId;
            if (isOneOf(value.align, TEXT_ALIGNS)) node.align = value.align;
            if (isFiniteNumber(value.letterSpacing)) node.letterSpacing = value.letterSpacing;
            if (isFiniteNumber(value.lineHeight)) node.lineHeight = value.lineHeight;
            if (isOneOf(value.direction, TEXT_DIRECTIONS)) node.direction = value.direction;
            return node;
        }
        case 'image': {
            if (!isString(value.imageId)) return undefined;
            const node: ImageNode = { ...base, type: 'image', imageId: value.imageId };
            const fit = toOptionalEnum(
                value.fit,
                IMAGE_FITS,
                repairs,
                'node.fit: unknown fit dropped',
            );
            if (fit !== undefined) node.fit = fit;
            return node;
        }
        case 'shape': {
            if (!isOneOf(value.shape, SHAPE_KINDS)) return undefined;
            const fill = toOptionalColor(value.fill, repairs, 'node.fill: invalid colour dropped');
            const stroke = toOptionalColor(
                value.stroke,
                repairs,
                'node.stroke: invalid colour dropped',
            );
            const style = {
                ...(fill !== undefined ? { fill } : {}),
                ...(stroke !== undefined ? { stroke } : {}),
            };
            switch (value.shape) {
                case 'line':
                case 'polygon': {
                    // `points` is authoritative for a line/polygon: a stale `size`
                    // alongside it is dropped rather than carried (nit).
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { size: _omittedSize, ...baseWithoutSize } = base;
                    void _omittedSize;
                    if (!Array.isArray(value.points)) {
                        // Point-less shape. Do NOT reject the whole document: a
                        // pre-geometry (P2-era) line/polygon is otherwise valid.
                        // Repair by synthesising a box outline from `size` when
                        // present; without `size` there is no geometry to stand in,
                        // so drop just this node (the collection helper records it).
                        if (base.size === undefined) {
                            repairs?.push(
                                `${value.type}.${value.shape}: no points or size — node dropped`,
                            );
                            return undefined;
                        }
                        const { w, h } = base.size;
                        repairs?.push(
                            `${value.type}.${value.shape}: missing points synthesised from size`,
                        );
                        return {
                            ...baseWithoutSize,
                            type: 'shape',
                            shape: value.shape,
                            points: [[0, 0], [w, h]],
                            closed: value.shape === 'polygon',
                            ...style,
                        };
                    }
                    const points: [hm, hm][] = [];
                    for (const point of value.points) {
                        if (!Array.isArray(point) || point.length < 2) return undefined;
                        const x = isHm(point[0]);
                        const y = isHm(point[1]);
                        if (x === undefined || y === undefined) return undefined;
                        points.push([x, y]);
                    }
                    return {
                        ...baseWithoutSize,
                        type: 'shape',
                        shape: value.shape,
                        points,
                        closed: value.closed === true || (value.closed === undefined && value.shape === 'polygon'),
                        ...style,
                    };
                }
                case 'rectangle': {
                    const node: Node = { ...base, type: 'shape', shape: 'rectangle', ...style };
                    const cornerRadius = toOptionalHm(value.cornerRadius);
                    if (cornerRadius !== undefined) {
                        node.cornerRadius = cornerRadius;
                    }
                    return node;
                }
                case 'ellipse':
                    return { ...base, type: 'shape', shape: 'ellipse', ...style };
            }
            return undefined;
        }
        case 'qr': {
            const node: QrNode = {
                ...base,
                type: 'qr',
                data: toContentSource(value.data) ?? { kind: 'static', value: '' },
            };
            const errorCorrection = toOptionalEnum(
                value.errorCorrection,
                QR_ERROR_CORRECTIONS,
                repairs,
                'node.qr.errorCorrection: unknown level dropped',
            );
            if (errorCorrection !== undefined) node.errorCorrection = errorCorrection;
            return node;
        }
        case 'barcode': {
            const node: BarcodeNode = {
                ...base,
                type: 'barcode',
                data: toContentSource(value.data) ?? { kind: 'static', value: '' },
            };
            const symbology = toOptionalEnum(
                value.symbology,
                BARCODE_SYMBOLOGIES,
                repairs,
                'node.barcode.symbology: unknown symbology dropped',
            );
            if (symbology !== undefined) node.symbology = symbology;
            return node;
        }
    }
};

const toFontSource = (value: unknown): FontRef['source'] | undefined => {
    if (!isRecord(value)) return undefined;
    if (value.kind === 'system') {
        return isString(value.descriptor)
            ? { kind: 'system', descriptor: value.descriptor }
            : undefined;
    }
    if (value.kind === 'imported') {
        const asset = isAssetRef(value.asset);
        if (!asset) return undefined;
        return {
            kind: 'imported',
            asset,
            ...(isString(value.fingerprint) ? { fingerprint: value.fingerprint } : {}),
        };
    }
    return undefined;
};

export const isFontRef = (value: unknown): FontRef | undefined => {
    if (!isRecord(value)) return undefined;
    if (!isString(value.fontId) || !isString(value.familyName) || !isString(value.name)) {
        return undefined;
    }
    const source = toFontSource(value.source);
    if (!source) return undefined;
    return {
        fontId: value.fontId,
        familyName: value.familyName,
        name: value.name,
        ...(isString(value.alt) ? { alt: value.alt } : {}),
        source,
    };
};

export const isImageRef = (value: unknown): ImageRef | undefined => {
    if (!isRecord(value)) return undefined;
    if (!isString(value.imageId) || !isString(value.name)) return undefined;
    const source = isAssetRef(value.source);
    if (!source) return undefined;
    const widthPx = isFiniteNumber(value.widthPx) ? Math.round(value.widthPx) : undefined;
    const heightPx = isFiniteNumber(value.heightPx) ? Math.round(value.heightPx) : undefined;
    if (widthPx === undefined || heightPx === undefined) return undefined;
    return {
        imageId: value.imageId,
        name: value.name,
        ...(isString(value.alt) ? { alt: value.alt } : {}),
        source,
        widthPx,
        heightPx,
    };
};

export const isCsvRef = (value: unknown): CsvRef | undefined => {
    if (!isRecord(value)) return undefined;
    if (!isString(value.csvId) || !isString(value.name)) return undefined;
    const source = isAssetRef(value.source);
    if (!source) return undefined;
    return {
        csvId: value.csvId,
        name: value.name,
        ...(isString(value.alt) ? { alt: value.alt } : {}),
        source,
    };
};

export const isGlobalSpec = (value: unknown): GlobalSpec | undefined => {
    if (!isRecord(value)) return undefined;
    if (!isString(value.name) || !isString(value.url) || !isString(value.extract)) {
        return undefined;
    }
    if (!isFiniteNumber(value.expiresAt)) return undefined;
    return {
        name: value.name,
        url: value.url,
        extract: value.extract,
        expiresAt: Math.floor(value.expiresAt),
    };
};

// ---------------------------------------------------------------------------
// Thumb (trust boundary)
// ---------------------------------------------------------------------------

const THUMB_MAX_SIDE = 512;
const THUMB_MAX_BYTES = 64 * 1024;

const rasterSubtype = (mediaType: string): 'png' | 'jpeg' | 'webp' | undefined => {
    const sub = mediaType.toLowerCase().replace(/^image\//, '').replace(/^x-/, '');
    if (sub === 'png') return 'png';
    if (sub === 'jpeg' || sub === 'jpg') return 'jpeg';
    if (sub === 'webp') return 'webp';
    return undefined;
};

const decodeDataUrl = (dataUrl: string): { bytes: Uint8Array; mediaType: string } | undefined => {
    if (!dataUrl.startsWith('data:')) return undefined;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return undefined;
    const header = dataUrl.slice(5, comma);
    const base64 = dataUrl.slice(comma + 1).replace(/\s+/g, '');
    const parts = header.toLowerCase().split(';');
    if (!parts.includes('base64')) return undefined;
    try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return { bytes, mediaType: parts[0] ?? '' };
    } catch {
        return undefined;
    }
};

const readPngSize = (bytes: Uint8Array): { width: number; height: number } | undefined => {
    if (bytes.length < 24) return undefined;
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < signature.length; i += 1) {
        if (bytes[i] !== signature[i]) return undefined;
    }
    // The first chunk must be IHDR ("IHDR" at bytes 12–15).
    if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
        return undefined;
    }
    const width = ((bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!) >>> 0;
    const height =
        ((bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!) >>> 0;
    return { width, height };
};

const readJpegSize = (bytes: Uint8Array): { width: number; height: number } | undefined => {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }
        let marker = bytes[offset + 1]!;
        while (marker === 0xff && offset + 1 < bytes.length) {
            offset += 1;
            marker = bytes[offset + 1]!;
        }
        offset += 2;
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (marker === 0xd9) return undefined;
        if (offset + 1 >= bytes.length) return undefined;
        const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
        const isStartOfFrame =
            (marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf);
        if (isStartOfFrame) {
            if (offset + 7 >= bytes.length) return undefined;
            const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
            const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
            return { width, height };
        }
        if (marker === 0xda) return undefined;
        offset += length;
    }
    return undefined;
};

const readWebpSize = (bytes: Uint8Array): { width: number; height: number } | undefined => {
    if (bytes.length < 30) return undefined;
    if (
        bytes[0] !== 0x52 ||
        bytes[1] !== 0x49 ||
        bytes[2] !== 0x46 ||
        bytes[3] !== 0x46 ||
        bytes[8] !== 0x57 ||
        bytes[9] !== 0x45 ||
        bytes[10] !== 0x42 ||
        bytes[11] !== 0x50
    ) {
        return undefined;
    }
    const fourcc = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (fourcc === 'VP8X') {
        const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
        const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
        return { width, height };
    }
    if (fourcc === 'VP8 ') {
        if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined;
        const width = (bytes[26]! | (bytes[27]! << 8)) & 0x3fff;
        const height = (bytes[28]! | (bytes[29]! << 8)) & 0x3fff;
        return { width, height };
    }
    if (fourcc === 'VP8L') {
        if (bytes[20] !== 0x2f) return undefined;
        const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
        const width = (bits & 0x3fff) + 1;
        const height = ((bits >> 14) & 0x3fff) + 1;
        return { width, height };
    }
    return undefined;
};

const readRasterSize = (
    bytes: Uint8Array,
    subtype: 'png' | 'jpeg' | 'webp',
): { width: number; height: number } | undefined => {
    if (subtype === 'png') return readPngSize(bytes);
    if (subtype === 'jpeg') return readJpegSize(bytes);
    return readWebpSize(bytes);
};

/** Returns the repaired thumb, or `undefined` when it must be stripped. */
const toThumb = (value: unknown): LabelDoc['meta']['thumb'] | undefined => {
    if (value === undefined) return undefined;
    if (!isRecord(value)) return undefined;
    if (!isString(value.mediaType) || !isString(value.dataUrl)) return undefined;
    if (!isFiniteNumber(value.at)) return undefined;
    const subtype = rasterSubtype(value.mediaType);
    if (!subtype) return undefined;
    const decoded = decodeDataUrl(value.dataUrl);
    if (!decoded || decoded.bytes.length === 0 || decoded.bytes.length > THUMB_MAX_BYTES) {
        return undefined;
    }
    // Trust boundary: the data URL's own MIME segment must agree with `mediaType`.
    if (decoded.mediaType !== value.mediaType.toLowerCase()) return undefined;
    const size = readRasterSize(decoded.bytes, subtype);
    if (!size || size.width <= 0 || size.height <= 0) return undefined;
    if (Math.max(size.width, size.height) > THUMB_MAX_SIDE) return undefined;
    return { mediaType: value.mediaType, dataUrl: value.dataUrl, at: Math.floor(value.at) };
};

// ---------------------------------------------------------------------------
// Collection helpers
// ---------------------------------------------------------------------------

const toArray = <T>(
    value: unknown,
    validate: (item: unknown, repairs?: string[]) => T | undefined,
    label: string,
    errors: string[],
    repairs?: string[],
): T[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        errors.push(`${label}: must be an array`);
        return [];
    }
    const out: T[] = [];
    value.forEach((item, index) => {
        const itemRepairs: string[] = [];
        const parsed = validate(item, itemRepairs);
        for (const repair of itemRepairs) repairs?.push(`${label}[${index}]: ${repair}`);
        if (parsed === undefined) errors.push(`${label}[${index}]: invalid entry`);
        else out.push(parsed);
    });
    return out;
};

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const isLabelDoc = (raw: unknown): ValidationResult => {
    if (!isRecord(raw)) return { ok: false, errors: ['document: must be an object'] };
    if (raw.version !== 1) {
        return { ok: false, errors: [`version: unsupported document version ${String(raw.version)}`] };
    }

    const errors: string[] = [];
    const repairs: string[] = [];

    if (!isRecord(raw.meta)) return { ok: false, errors: ['meta: must be an object'] };
    const metaRaw = raw.meta;
    const id = isString(metaRaw.id) && metaRaw.id.length > 0 ? metaRaw.id : undefined;
    if (id === undefined) errors.push('meta.id: must be a non-empty string');
    const name = isString(metaRaw.name) ? metaRaw.name : '';
    const createdAt = isFiniteNumber(metaRaw.createdAt)
        ? Math.floor(metaRaw.createdAt)
        : undefined;
    if (createdAt === undefined) errors.push('meta.createdAt: must be a finite epoch-seconds number');
    const updatedAt = isFiniteNumber(metaRaw.updatedAt)
        ? Math.floor(metaRaw.updatedAt)
        : undefined;
    if (updatedAt === undefined) errors.push('meta.updatedAt: must be a finite epoch-seconds number');
    const thumb = toThumb(metaRaw.thumb);
    const presetId = isString(metaRaw.presetId) ? metaRaw.presetId : undefined;

    if (!isRecord(raw.label)) return { ok: false, errors: [...errors, 'label: must be an object'] };
    const labelRaw = raw.label;
    const backingW = isHm(labelRaw.backingW);
    const backingH = isHm(labelRaw.backingH);
    if (backingW === undefined || backingW <= 0) {
        errors.push('label.backingW: must be a positive hm integer');
    }
    if (backingH === undefined || backingH <= 0) {
        errors.push('label.backingH: must be a positive hm integer');
    }
    const dpi = normalizeDpi(labelRaw.dpi);
    const regions = toArray(labelRaw.regions, isRegion, 'label.regions', errors, repairs);
    const printDirection = isOneOf(labelRaw.printDirection, PRINT_DIRECTIONS)
        ? labelRaw.printDirection
        : 'top';

    const nodes = toArray(raw.nodes, isNode, 'nodes', errors, repairs);
    const seenNodeIds = new Set<string>();
    for (const node of nodes) {
        if (seenNodeIds.has(node.id)) {
            errors.push(`nodes: duplicate id "${node.id}"`);
        } else {
            seenNodeIds.add(node.id);
        }
        if (node.parentId === node.id) {
            errors.push(`nodes: node "${node.id}" is its own parent`);
        }
    }

    if (raw.data !== undefined && !isRecord(raw.data)) {
        errors.push('data: must be an object');
    }
    const dataRaw = isRecord(raw.data) ? raw.data : {};
    let csv: CsvRef | undefined;
    if (dataRaw.csv !== undefined) {
        csv = isCsvRef(dataRaw.csv);
        if (!csv) errors.push('data.csv: invalid CsvRef');
    }
    const sampleRowIndex = isFiniteNumber(dataRaw.sampleRowIndex)
        ? Math.round(dataRaw.sampleRowIndex)
        : 0;
    const globals = toArray(dataRaw.globals, isGlobalSpec, 'data.globals', errors);

    if (raw.resources !== undefined && !isRecord(raw.resources)) {
        errors.push('resources: must be an object');
    }
    const resourcesRaw = isRecord(raw.resources) ? raw.resources : {};
    const fonts = toArray(resourcesRaw.fonts, isFontRef, 'resources.fonts', errors);
    const images = toArray(resourcesRaw.images, isImageRef, 'resources.images', errors);

    if (errors.length > 0) return { ok: false, errors };

    return {
        ok: true,
        repairs,
        doc: {
            version: 1,
            meta: {
                id: id!,
                name,
                createdAt: createdAt!,
                updatedAt: updatedAt!,
                ...(thumb ? { thumb } : {}),
                ...(presetId !== undefined ? { presetId } : {}),
            },
            label: {
                backingW: backingW!,
                backingH: backingH!,
                dpi,
                regions,
                printDirection,
            },
            nodes,
            data: { ...(csv ? { csv } : {}), sampleRowIndex, globals },
            resources: { fonts, images },
        },
    };
};

/**
 * Migration seam, keyed on `raw.version`. Today only v1 exists, so this is the
 * identity. P8's import adds cases here (returning a v1-shaped raw object) and
 * `isLabelDoc` remains the single structural gate.
 *
 * Returns `unknown` rather than `LabelDoc` on purpose: a future/absent version
 * cannot produce a `LabelDoc`, and this parse path must never throw. Leaving the
 * raw untouched lets `isLabelDoc` reject it with a precise version error.
 */
export const migrate = (raw: unknown): unknown => {
    if (!isRecord(raw)) return raw;
    switch (raw.version) {
        case 1:
            return raw;
        default:
            return raw;
    }
};

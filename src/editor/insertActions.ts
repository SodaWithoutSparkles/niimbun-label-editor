import type { hm } from '../core/hm';
import type { InsertAction } from '../store/slices/toolsSlice';
import {
    DEFAULT_SHAPE_FILL,
    DEFAULT_SHAPE_STROKE,
    DEFAULT_SHAPE_STROKE_WIDTH,
} from '../core/doc/objects';
import type { ImageRef, Node, ShapeKind } from '../core/doc/types';

/**
 * Insert defaults (ui-spec.md §4). Most rail actions place one node on click;
 * polygon stays armed while its vertices are collected. Pure data — the store's
 * `addNode` mints the id, so the placeholder `id` here is overwritten.
 *
 * Sizes are hm (hundredths of a mm). They are deliberate defaults, not a design
 * decision; the user resizes with the Transformer.
 */

/** Placeholder id; `docSlice.addNode` replaces it (decision 39). */
const PLACEHOLDER_ID = 'pending-insert';

const base = (x: hm, y: hm) => ({
    id: PLACEHOLDER_ID,
    parentId: null,
    visible: true,
    locked: false,
    transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 },
});

/** Default box for content nodes that carry a `size` (mm → hm). */
const DEFAULT_BOX = { w: 1500 as hm, h: 1000 as hm };

/** Default boxes for the P5 object inserts (mm → hm). */
const DEFAULT_IMAGE_BOX = { w: 1500 as hm, h: 1500 as hm };
const DEFAULT_QR_BOX = { w: 1500 as hm, h: 1500 as hm };
const DEFAULT_BARCODE_BOX = { w: 2000 as hm, h: 800 as hm };

/** Default static payloads for the armed qr / barcode inserts (P5). */
export const DEFAULT_QR_PAYLOAD = 'https://example.com';
export const DEFAULT_BARCODE_PAYLOAD = '123456789012';

export const createPolygonNode = (worldPoints: [hm, hm][]): Node => {
    const x = Math.min(...worldPoints.map(([pointX]) => pointX)) as hm;
    const y = Math.min(...worldPoints.map(([, pointY]) => pointY)) as hm;
    return {
        ...base(x, y),
        type: 'shape',
        shape: 'polygon',
        points: worldPoints.map(([pointX, pointY]) => [pointX - x, pointY - y]),
        closed: true,
        fill: DEFAULT_SHAPE_FILL,
        stroke: DEFAULT_SHAPE_STROKE,
        strokeWidth: DEFAULT_SHAPE_STROKE_WIDTH,
    };
};

/** Shape kinds a rail action can arm; `null` for non-shape actions. */
export const shapeKindForAction = (action: InsertAction): ShapeKind | null => {
    switch (action) {
        case 'shape:line':
            return 'line';
        case 'shape:rectangle':
            return 'rectangle';
        case 'shape:ellipse':
            return 'ellipse';
        case 'shape:polygon':
            return 'polygon';
        default:
            return null;
    }
};

/** The shape ids offered by the `Shape ▾` rail menu, in menu order. */
export const SHAPE_ACTIONS = [
    'shape:line',
    'shape:rectangle',
    'shape:ellipse',
    'shape:polygon',
] as const satisfies readonly InsertAction[];

/**
 * Build the default node for an armed insert action at world point `(x, y)`.
 * Returns `null` for `select` (the resting state — nothing to place).
 */
export const createNodeForInsert = (action: InsertAction, x: hm, y: hm): Node | null => {
    const common = base(x, y);
    switch (action) {
        case 'text':
            return {
                ...common,
                type: 'text',
                text: { kind: 'static', value: '' },
                size: { w: 2000, h: 800 },
                fontSize: 300,
                fontFamily: 'sans-serif',
                fontStyle: 'normal',
                align: 'left',
            };
        case 'image':
            return { ...common, type: 'image', imageId: '', size: { ...DEFAULT_IMAGE_BOX }, fit: 'contain' };
        case 'qr':
            return {
                ...common,
                type: 'qr',
                data: { kind: 'static', value: DEFAULT_QR_PAYLOAD },
                errorCorrection: 'M',
                size: { ...DEFAULT_QR_BOX },
            };
        case 'barcode':
            return {
                ...common,
                type: 'barcode',
                data: { kind: 'static', value: DEFAULT_BARCODE_PAYLOAD },
                symbology: 'code128',
                size: { ...DEFAULT_BARCODE_BOX },
            };
        case 'shape:line':
            // Open shape: no fill (`'transparent'`). The stroke/width defaults
            // are seeded so the inspector shows the real values (#8).
            return {
                ...common,
                type: 'shape',
                shape: 'line',
                points: [[0, 0], [1500, 0]],
                fill: DEFAULT_SHAPE_FILL,
                stroke: DEFAULT_SHAPE_STROKE,
                strokeWidth: DEFAULT_SHAPE_STROKE_WIDTH,
            };
        case 'shape:polygon':
            return null;
        case 'shape:rectangle':
        case 'shape:ellipse':
            // Fill defaults to `'transparent'` (no fill), seeded so the inspector
            // shows a real, round-trippable colour.
            return {
                ...common,
                type: 'shape',
                shape: shapeKindForAction(action)!,
                size: { ...DEFAULT_BOX },
                fill: DEFAULT_SHAPE_FILL,
                stroke: DEFAULT_SHAPE_STROKE,
                strokeWidth: DEFAULT_SHAPE_STROKE_WIDTH,
            };
        default:
            return null;
    }
};

/**
 * Build an `ImageNode` for an imported `ImageRef` at top-left `(x, y)`, sized to
 * the source aspect within a `maxSide` box (never distorted). Used by the image
 * import dialog, which places the imported asset at the label centre.
 */
export const createImageNodeForRef = (
    x: hm,
    y: hm,
    ref: Pick<ImageRef, 'imageId' | 'widthPx' | 'heightPx'>,
    maxSide: hm = 2000,
): Node => {
    const aspect = ref.widthPx > 0 && ref.heightPx > 0 ? ref.widthPx / ref.heightPx : 1;
    let w = maxSide;
    let h = Math.round(maxSide / aspect);
    if (h > maxSide) {
        h = maxSide;
        w = Math.round(maxSide * aspect);
    }
    return {
        ...base(x, y),
        type: 'image',
        imageId: ref.imageId,
        size: { w: Math.max(1, w) as hm, h: Math.max(1, h) as hm },
        fit: 'contain',
    };
};

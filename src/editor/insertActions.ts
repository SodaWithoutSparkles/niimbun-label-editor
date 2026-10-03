import type { hm } from '../core/hm';
import type { InsertAction } from '../store/slices/toolsSlice';
import type { Node, ShapeKind } from '../core/doc/types';

/**
 * One-shot insert defaults (ui-spec.md §4). A rail action arms, the user clicks
 * a point, and a node of a sensible default size is created there
 * (click-to-place, then resize via handles). Pure data — the store's `addNode`
 * mints the id, so the placeholder `id` here is overwritten.
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
            return { ...common, type: 'image', imageId: '', size: { ...DEFAULT_BOX } };
        case 'qr':
            return { ...common, type: 'qr', data: { kind: 'static', value: '' }, size: { ...DEFAULT_BOX } };
        case 'barcode':
            return { ...common, type: 'barcode', data: { kind: 'static', value: '' }, size: { ...DEFAULT_BOX } };
        case 'shape:line':
            return { ...common, type: 'shape', shape: 'line', points: [[0, 0], [1500, 0]] };
        case 'shape:polygon':
            return {
                ...common,
                type: 'shape',
                shape: 'polygon',
                points: [[0, 0], [1200, 0], [1200, 1200], [0, 1200]],
                closed: true,
            };
        case 'shape:rectangle':
        case 'shape:ellipse':
            return { ...common, type: 'shape', shape: shapeKindForAction(action)!, size: { ...DEFAULT_BOX } };
        default:
            return null;
    }
};

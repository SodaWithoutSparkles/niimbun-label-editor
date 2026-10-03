import { MM_PER_INCH, roundHm, type hm } from './hm';
import { regionBounds } from './doc/derive';
import type { Mat2D } from './doc/derive';
import type { Region } from './doc/types';

/**
 * Viewport math for the editor's bounded, fit-to-viewport stage. Pure and
 * React-free (`src/core` invariant). This is **view state only** — it is never
 * stored in the document; the document keeps integer `hm` values only.
 *
 * Transform: a world point (`hm`) maps to screen CSS px as
 *
 *     screen = pan + R(rotation) · (world · zoom)
 *
 * where `rotation` is clockwise 90° in the y-down screen space. `x`/`y` are the
 * on-screen position of the world origin; `zoom` is CSS px per `hm`.
 */

export interface Viewport {
    x: number;
    y: number;
    zoom: number;
    rotation: 0 | 90;
}

/**
 * Smallest usable zoom (CSS px per `hm`). `fitZoom` clamps to this and
 * `screenToWorld` divides by it, so a degenerate viewport can never produce
 * `Infinity`/`NaN` that would reach the document via `screenToHm`.
 */
export const MIN_ZOOM = 1e-6;

/** A 2D point. World points are `hm` (may be fractional until rounded); screen points are CSS px. */
export interface Point {
    x: number;
    y: number;
}

/** Axis-aligned rectangle. World coordinates may be fractional after a transform.
 * Structurally identical to `Bounds` (`./doc/derive`); the two are interchangeable. */
export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** The label backing size; structurally compatible with `LabelDoc['label']`. */
export interface Backing {
    backingW: hm;
    backingH: hm;
}

/** The available canvas area in CSS px. */
export interface Size {
    w: number;
    h: number;
}

/** World (`hm`) → screen CSS px. Inverse of `screenToWorld`. */
export const worldToScreen = (point: Point, viewport: Viewport): Point => {
    const sx = point.x * viewport.zoom;
    const sy = point.y * viewport.zoom;
    return viewport.rotation === 90
        ? { x: viewport.x - sy, y: viewport.y + sx }
        : { x: viewport.x + sx, y: viewport.y + sy };
};

/** Screen CSS px → world `hm` (fractional; round with `screenToHm` before storing). */
export const screenToWorld = (point: Point, viewport: Viewport): Point => {
    const dx = point.x - viewport.x;
    const dy = point.y - viewport.y;
    const zoom = viewport.zoom > 0 ? viewport.zoom : MIN_ZOOM;
    return viewport.rotation === 90
        ? { x: dy / zoom, y: -dx / zoom }
        : { x: dx / zoom, y: dy / zoom };
};

/** `screenToWorld` rounded to integer `hm` — the form safe to write to the document. */
export const screenToHm = (point: Point, viewport: Viewport): Point => {
    const world = screenToWorld(point, viewport);
    return { x: roundHm(world.x), y: roundHm(world.y) };
};

/**
 * The label's on-screen bounding box for a viewport. At `rotation: 90` the
 * backing's axes swap, so the world origin corner is offset by the rotated
 * extent (the label's top-left is not the on-screen pan point).
 */
export const labelScreenRect = (viewport: Viewport, backing: Backing): Rect => {
    const w = backing.backingW * viewport.zoom;
    const h = backing.backingH * viewport.zoom;
    return viewport.rotation === 90
        ? { x: viewport.x - h, y: viewport.y, w: h, h: w }
        : { x: viewport.x, y: viewport.y, w, h };
};

/**
 * CSS px per `hm` at "real" size preview (`ui-spec.md` §6). `devicePixelRatio`
 * does **not** feed into this — it only affects the backing render resolution
 * (`backingPixelSize`).
 */
export const realZoom = (ppi: number): number => ppi / MM_PER_INCH / 100;

/**
 * Zoom that fits the backing into the available area. Pass `rotation: 90` when
 * the view is rotated so the long axis gets a chance at the wider screen. Never
 * returns a non-positive zoom: degenerate input clamps to `MIN_ZOOM`.
 */
export const fitZoom = (
    backingW: hm,
    backingH: hm,
    availW: number,
    availH: number,
    rotation: 0 | 90 = 0,
): number => {
    const w = rotation === 90 ? backingH : backingW;
    const h = rotation === 90 ? backingW : backingH;
    if (w <= 0 || h <= 0 || availW <= 0 || availH <= 0) return MIN_ZOOM;
    return Math.max(MIN_ZOOM, Math.min(availW / w, availH / h));
};

/**
 * Backing-store pixel size for a canvas at `devicePixelRatio`. This is the
 * raster resolution only; the label still measures `hm × zoom` CSS px on screen.
 */
export const backingPixelSize = (
    backingW: hm,
    backingH: hm,
    zoom: number,
    devicePixelRatio: number,
): { width: number; height: number } => ({
    width: Math.round(backingW * zoom * devicePixelRatio),
    height: Math.round(backingH * zoom * devicePixelRatio),
});

/**
 * Clamp an axis offset so a length-`size` rect stays in `[0, avail]` when it
 * fits, and keeps the `[0, avail]` span covered when it does not. Either way the
 * label can never be panned off-screen.
 */
const clampOffset = (offset: number, size: number, avail: number): number => {
    const limit = avail - size;
    return Math.min(Math.max(offset, Math.min(0, limit)), Math.max(0, limit));
};

/** Clamp pan so the backing can never be lost off-screen at any zoom. */
export const clampPan = (viewport: Viewport, backing: Backing, avail: Size): Viewport => {
    const rect = labelScreenRect(viewport, backing);
    const left = clampOffset(rect.x, rect.w, avail.w);
    const top = clampOffset(rect.y, rect.h, avail.h);
    return viewport.rotation === 90
        ? { ...viewport, x: left + rect.w, y: top }
        : { ...viewport, x: left, y: top };
};

/** Center the (current-zoom) backing in the available area, then clamp. */
export const centerPan = (viewport: Viewport, backing: Backing, avail: Size): Viewport => {
    const rect = labelScreenRect(viewport, backing);
    const left = (avail.w - rect.w) / 2;
    const top = (avail.h - rect.h) / 2;
    return clampPan(
        viewport.rotation === 90
            ? { ...viewport, x: left + rect.w, y: top }
            : { ...viewport, x: left, y: top },
        backing,
        avail,
    );
};

const applyMat2D = (matrix: Mat2D, point: Point): Point => ({
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

/** Axis-aligned bounds of `bounds` after `matrix`. */
export const transformBounds = (bounds: Rect, matrix: Mat2D): Rect => {
    const corners = [
        applyMat2D(matrix, { x: bounds.x, y: bounds.y }),
        applyMat2D(matrix, { x: bounds.x + bounds.w, y: bounds.y }),
        applyMat2D(matrix, { x: bounds.x, y: bounds.y + bounds.h }),
        applyMat2D(matrix, { x: bounds.x + bounds.w, y: bounds.y + bounds.h }),
    ];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of corners) {
        if (corner.x < minX) minX = corner.x;
        if (corner.y < minY) minY = corner.y;
        if (corner.x > maxX) maxX = corner.x;
        if (corner.y > maxY) maxY = corner.y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

/**
 * A hit-test target: a resolved node reduced to what selection needs. `bounds`
 * is a **world-space AABB** in `hm`, already transformed by the node's effective
 * transform (mirrors `ResolvedNode.bounds` in `editor/render/resolve.ts`), so no
 * transform is composed here. `visible`/`locked` are the *effective* values
 * (`effectiveVisible`/`effectiveLocked`), also precomputed by the render path.
 *
 * Structurally a `ResolvedNode` satisfies this, so resolved output can be passed
 * directly. `Rect` and `Bounds` (`./doc/derive`) are interchangeable shapes.
 */
export interface HitTestable {
    id: string;
    /** World-space AABB, already under the effective transform. */
    bounds: Rect;
    /** Effective visibility (self && ancestors). */
    visible: boolean;
    /** Effective lock (self || ancestors). Locked nodes are not selectable. */
    locked: boolean;
}

/**
 * Topmost selectable node id at a world point, or `null`. `targets` is in
 * z-order (array order): a later entry wins an overlap. Hidden or locked nodes
 * are never selectable (`ui-spec.md` §7 makes lock first-class).
 */
export const hitTestWorld = (point: Point, targets: readonly HitTestable[]): string | null => {
    let hit: string | null = null;
    for (const target of targets) {
        if (!target.visible || target.locked) continue;
        const b = target.bounds;
        if (point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h) {
            hit = target.id;
        }
    }
    return hit;
};

/** Zoom/rotation-independent hit test: converts the screen point to world first. */
export const hitTestScreen = (
    point: Point,
    viewport: Viewport,
    targets: readonly HitTestable[],
): string | null => hitTestWorld(screenToWorld(point, viewport), targets);

export type SnapAxis = 'x' | 'y';
export type SnapEdge = 'start' | 'center' | 'end';
export type SnapSource = 'backing' | 'region' | 'sibling' | 'grid';

/** One candidate alignment. The caller picks the best (e.g. smallest |delta|). */
export interface SnapCandidate {
    axis: SnapAxis;
    edge: SnapEdge;
    /** World coordinate of the target line. */
    guide: number;
    /** Delta to add to `moving` on `axis` to land `edge` on `guide`. */
    delta: number;
    source: SnapSource;
}

export interface SnapContext {
    backing: Backing;
    regions?: readonly Region[];
    /** Sibling node world bounds (already transformed). */
    siblings?: readonly Rect[];
    /** Grid step in `hm`; when > 0, grid candidates are added. */
    grid?: hm;
}

/**
 * Pure snap candidates to backing edges, region edges, and sibling bounds
 * (plus an optional grid). The caller filters by distance and picks.
 */
export const snapCandidates = (moving: Rect, context: SnapContext): SnapCandidate[] => {
    const vertical: { at: number; source: SnapSource }[] = [
        { at: 0, source: 'backing' },
        { at: context.backing.backingW, source: 'backing' },
    ];
    const horizontal: { at: number; source: SnapSource }[] = [
        { at: 0, source: 'backing' },
        { at: context.backing.backingH, source: 'backing' },
    ];
    for (const region of context.regions ?? []) {
        const box = regionBounds(region);
        // A zero-area region (e.g. a point/degenerate circle) has no edges to snap to.
        if (box.w <= 0 && box.h <= 0) continue;
        vertical.push({ at: box.x, source: 'region' }, { at: box.x + box.w, source: 'region' });
        horizontal.push({ at: box.y, source: 'region' }, { at: box.y + box.h, source: 'region' });
    }
    for (const sibling of context.siblings ?? []) {
        vertical.push(
            { at: sibling.x, source: 'sibling' },
            { at: sibling.x + sibling.w, source: 'sibling' },
        );
        horizontal.push(
            { at: sibling.y, source: 'sibling' },
            { at: sibling.y + sibling.h, source: 'sibling' },
        );
    }

    const candidates: SnapCandidate[] = [];
    const add = (axis: SnapAxis, lines: readonly { at: number; source: SnapSource }[]): void => {
        const start = axis === 'x' ? moving.x : moving.y;
        const size = axis === 'x' ? moving.w : moving.h;
        const edges: { edge: SnapEdge; at: number }[] = [
            { edge: 'start', at: start },
            { edge: 'center', at: start + size / 2 },
            { edge: 'end', at: start + size },
        ];
        for (const line of lines) {
            for (const edge of edges) {
                candidates.push({
                    axis,
                    edge: edge.edge,
                    guide: line.at,
                    delta: line.at - edge.at,
                    source: line.source,
                });
            }
        }
        const grid = context.grid ?? 0;
        if (grid > 0) {
            for (const edge of edges) {
                const guide = Math.round(edge.at / grid) * grid;
                candidates.push({ axis, edge: edge.edge, guide, delta: guide - edge.at, source: 'grid' });
            }
        }
    };
    add('x', vertical);
    add('y', horizontal);
    return candidates;
};

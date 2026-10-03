import {
    centerPan,
    clampPan,
    fitZoom,
    labelScreenRect,
    realZoom,
    screenToWorld,
    worldToScreen,
} from '../core/viewport';
import type { Backing, Point, Size, Viewport } from '../core/viewport';
import type { ZoomMode } from '../store/slices/viewSlice';

/**
 * Pure bindings between the editor's view state (ui-spec.md §6) and the
 * `core/viewport` engine. No React, no Konva, no store — so zoom/pan/rotation
 * behavior is unit-testable without a canvas.
 */

/** Resolve the CSS px-per-`hm` zoom for the current mode. */
export const resolveZoom = (
    mode: ZoomMode,
    manualZoom: number,
    backing: Backing,
    avail: Size,
    rotation: 0 | 90,
    ppi: number,
): number => {
    if (mode === 'real') return realZoom(ppi);
    if (mode === 'manual') return manualZoom;
    return fitZoom(backing.backingW, backing.backingH, avail.w, avail.h, rotation);
};

/** A centred, clamped viewport at `zoom` for the given rotation. */
export const centeredViewport = (
    zoom: number,
    backing: Backing,
    avail: Size,
    rotation: 0 | 90,
): Viewport => centerPan({ x: 0, y: 0, zoom, rotation }, backing, avail);

/**
 * Zoom about a screen anchor, keeping the world point under it fixed. Returns a
 * clamped viewport. Used by wheel/double-click zoom.
 */
export const zoomAt = (
    viewport: Viewport,
    anchor: Point,
    nextZoom: number,
    backing: Backing,
    avail: Size,
): Viewport => {
    const world = screenToWorld(anchor, viewport);
    const zoom = Math.max(nextZoom, 1e-6);
    const pan: Point =
        viewport.rotation === 90
            ? { x: anchor.x + world.y * zoom, y: anchor.y - world.x * zoom }
            : { x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom };
    return clampPan({ ...viewport, x: pan.x, y: pan.y, zoom }, backing, avail);
};

/** Step zoom by a factor about the viewport centre, then clamp/centre. */
export const steppedZoom = (
    viewport: Viewport,
    factor: number,
    backing: Backing,
    avail: Size,
): Viewport => {
    const centre = { x: avail.w / 2, y: avail.h / 2 };
    const next = zoomAt(viewport, centre, viewport.zoom * factor, backing, avail);
    return clampPan(next, backing, avail);
};

/** Screen rect of the label for a viewport (re-export for overlay math). */
export { labelScreenRect, worldToScreen };

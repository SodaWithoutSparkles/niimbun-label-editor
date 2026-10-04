import type { UnionSubpath } from './regionOverlay';

/**
 * The **single** tracer for `union(regions)` silhouettes, shared by the editor
 * overlay (`src/components/editor/Overlays.tsx`) and the raster clip
 * (`clip.ts`). Keeping one implementation means the on-screen silhouette and the
 * printed clip can never drift.
 *
 * The caller fills the traced path with the canvas **default (nonzero)**
 * winding. Never pass `'evenodd'` — overlapping regions must stay wound
 * +1/+2/… and never cancel into an interior hole (plan.md:187).
 *
 * Every contour is wound the **same** direction: `regionUnionPath` normalizes
 * polygon orientation to match the rect/`arcTo`/`arc` tracing below (S6), so
 * nonzero fill truly equals `union(regions)`.
 *
 * Defensive geometry (M4): negative `w`/`h`/`r` are clamped to `0`. A negative
 * width would trace counter-clockwise (a hole) and a negative arc radius throws.
 */

/** The subset of a 2D path context the tracer needs (Konva.Context and the DOM 2D context both satisfy it). */
export interface PathTracer {
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
    closePath(): void;
}

/** Trace one axis-aligned box with the union's winding direction. */
const traceBox = (ctx: PathTracer, x: number, y: number, w: number, h: number): void => {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
};

/**
 * Begin a path and trace every union contour, scaling hm → target units
 * (`scale = 1` for the editor's hm-space layer, `1 / hmPerPx` for the raster
 * clip). The caller fills/clips afterwards.
 */
export const traceUnion = (
    ctx: PathTracer,
    subpaths: readonly UnionSubpath[],
    scale = 1,
): void => {
    ctx.beginPath();
    for (const path of subpaths) {
        switch (path.kind) {
            case 'rect': {
                traceBox(
                    ctx,
                    path.x * scale,
                    path.y * scale,
                    Math.max(0, path.w * scale),
                    Math.max(0, path.h * scale),
                );
                break;
            }
            case 'roundedRect': {
                const x = path.x * scale;
                const y = path.y * scale;
                const w = Math.max(0, path.w * scale);
                const h = Math.max(0, path.h * scale);
                const r = Math.max(0, Math.min(path.r * scale, w / 2, h / 2));
                if (r === 0) {
                    traceBox(ctx, x, y, w, h);
                    break;
                }
                ctx.moveTo(x + r, y);
                ctx.lineTo(x + w - r, y);
                ctx.arcTo(x + w, y, x + w, y + r, r);
                ctx.lineTo(x + w, y + h - r);
                ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
                ctx.lineTo(x + r, y + h);
                ctx.arcTo(x, y + h, x, y + h - r, r);
                ctx.lineTo(x, y + r);
                ctx.arcTo(x, y, x + r, y, r);
                ctx.closePath();
                break;
            }
            case 'circle': {
                const r = Math.max(0, path.r * scale);
                const cx = path.cx * scale;
                const cy = path.cy * scale;
                ctx.moveTo(cx + r, cy);
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.closePath();
                break;
            }
            case 'polygon': {
                const points = path.points;
                if (points.length === 0) break;
                ctx.moveTo(points[0]![0] * scale, points[0]![1] * scale);
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i]![0] * scale, points[i]![1] * scale);
                }
                ctx.closePath();
                break;
            }
        }
    }
};

import { useEffect, useRef, type FC } from 'react';
import type { Guide, Region } from '../../core/doc/types';
import { regionUnionBounds, type Bounds } from '../../core/doc/derive';
import { regionUnionPath, traceUnion } from '../../editor/render';
import { cn } from '../../utils/cn';

/**
 * Paper-type preview (phase 8, W4b): a DPR-aware DOM `<canvas>` that draws the
 * two preview passes, matching the editor overlay's appearance.
 *
 *   1. the `union(regions)` silhouette, filled with the **default nonzero
 *      winding** — never `'evenodd'`, or overlapping regions would punch
 *      interior holes (the silhouette would stop matching the printed clip);
 *   2. each `guide.line` as a stroked dashed line, after the fill.
 *
 * The backing store is sized from `getBoundingClientRect()` × `devicePixelRatio`
 * and redrawn whenever `regions`/`guides` change or the element resizes
 * (`ResizeObserver`).
 *
 * Fit bounds are the region-union bounds **∪** the guide endpoint bounds, so a
 * score line that extends past the printable silhouette is not cropped. With no
 * drawable region there is nothing to fill — the backing outline is stroked
 * instead of a blank filled box — but the guide pass still runs, so a
 * guide-only paper type is not blank.
 */

const SILHOUETTE_FILL = '#ffffff';
/** Matches `GUIDE_STROKE` in `components/editor/Overlays.tsx`. */
const GUIDE_STROKE = '#9ca3af';
const BACKING_OUTLINE_STROKE = '#4b5563';
const GUIDE_DASH: [number, number] = [6, 4];

/**
 * Bounds of the guide endpoints alone. Used to fit a preview that has guides
 * but no drawable region, so the guides are still drawn (there is no silhouette
 * to fill, but a guide-only paper type must not render blank).
 */
const guideBounds = (guides: readonly Guide[]): Bounds | undefined => {
    if (guides.length === 0) return undefined;
    let x = Number.POSITIVE_INFINITY;
    let y = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const guide of guides) {
        x = Math.min(x, guide.line.x1, guide.line.x2);
        y = Math.min(y, guide.line.y1, guide.line.y2);
        maxX = Math.max(maxX, guide.line.x1, guide.line.x2);
        maxY = Math.max(maxY, guide.line.y1, guide.line.y2);
    }
    return { x, y, w: maxX - x, h: maxY - y };
};

/** Region-union bounds stretched to include every guide endpoint. */
const includeGuideBounds = (base: Bounds, guides: readonly Guide[]): Bounds => {
    let { x, y } = base;
    let maxX = base.x + base.w;
    let maxY = base.y + base.h;
    for (const guide of guides) {
        x = Math.min(x, guide.line.x1, guide.line.x2);
        y = Math.min(y, guide.line.y1, guide.line.y2);
        maxX = Math.max(maxX, guide.line.x1, guide.line.x2);
        maxY = Math.max(maxY, guide.line.y1, guide.line.y2);
    }
    return { x, y, w: maxX - x, h: maxY - y };
};

/** Uniform hm → CSS-px fit scale; a zero-extent axis imposes no constraint. */
const fitScale = (bounds: Bounds, width: number, height: number): number => {
    const sx = bounds.w > 0 ? width / bounds.w : Number.POSITIVE_INFINITY;
    const sy = bounds.h > 0 ? height / bounds.h : Number.POSITIVE_INFINITY;
    const scale = Math.min(sx, sy);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
};

const drawBackingOutline = (ctx: CanvasRenderingContext2D, width: number, height: number): void => {
    ctx.strokeStyle = BACKING_OUTLINE_STROKE;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(0.5, 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
};

export interface PaperTypePreviewProps {
    regions: Region[];
    guides: Guide[];
    className?: string;
}

export const PaperTypePreview: FC<PaperTypePreviewProps> = ({ regions, guides, className }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const draw = () => {
            const ctx = canvas.getContext('2d');
            // happy-dom (and a canvas with 2D disabled) returns null.
            if (!ctx) return;

            const rect = canvas.getBoundingClientRect();
            const cssW = rect.width || canvas.clientWidth || 1;
            const cssH = rect.height || canvas.clientHeight || 1;
            const dpr = window.devicePixelRatio || 1;
            const backingW = Math.max(1, Math.round(cssW * dpr));
            const backingH = Math.max(1, Math.round(cssH * dpr));
            if (canvas.width !== backingW) canvas.width = backingW;
            if (canvas.height !== backingH) canvas.height = backingH;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);

            const unionBounds = regionUnionBounds(regions);
            // No drawable region → no silhouette to fill. Stroke the backing
            // outline (never a blank filled box) but keep going: guides still draw.
            if (!unionBounds) drawBackingOutline(ctx, cssW, cssH);

            const baseBounds = unionBounds ?? guideBounds(guides);
            // Nothing to draw at all: the backing outline above is the preview.
            if (!baseBounds) return;

            const bounds = includeGuideBounds(baseBounds, guides);
            const scale = fitScale(bounds, cssW, cssH);
            // hm → CSS px, offset so the fit bounds' origin lands at (0, 0).
            ctx.translate(-bounds.x * scale, -bounds.y * scale);

            // Pass 1 — the printable silhouette. Nonzero winding: no `'evenodd'`.
            if (unionBounds) {
                traceUnion(ctx, regionUnionPath(regions), scale);
                ctx.fillStyle = SILHOUETTE_FILL;
                ctx.fill();
            }

            // Pass 2 — guides, drawn after the fill in the editor guide style.
            ctx.strokeStyle = GUIDE_STROKE;
            ctx.lineWidth = 1;
            ctx.setLineDash(GUIDE_DASH);
            for (const guide of guides) {
                ctx.beginPath();
                ctx.moveTo(guide.line.x1 * scale, guide.line.y1 * scale);
                ctx.lineTo(guide.line.x2 * scale, guide.line.y2 * scale);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        };

        draw();

        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => draw());
        observer.observe(canvas);
        return () => observer.disconnect();
    }, [regions, guides]);

    return <canvas ref={canvasRef} className={cn('block h-full w-full', className)} />;
};

import React from 'react';
import { Layer, Line, Rect, Shape, Text } from 'react-konva';
import type { Guide } from '../../editor/render/guides';
import { regionUnionPath, resolveRegionOverlay, type UnionSubpath } from '../../editor/render/regionOverlay';
import { traceUnion } from '../../editor/render/unionPath';
import type { LabelDoc } from '../../core/doc/types';
import type { hm } from '../../core/hm';

/**
 * Minimal, inherited-appearance overlays for the preview (ui-spec.md §5):
 * the white union silhouette, preset guides, grid, and transient snap lines.
 * Data comes from `regionOverlay.ts` / `guides.ts`; styling is deliberately
 * subtle so it never competes with label content.
 */

const GUIDE_STROKE = '#9ca3af';
const GRID_STROKE = '#e5e7eb';

/**
 * Solid-white union silhouette — the label surface. `Shape` does not hit-test
 * (`listening={false}`), so empty-canvas selection still works. Tracing is the
 * shared `traceUnion`, so the overlay and the raster clip stay identical.
 */
const UnionSilhouette: React.FC<{ regions: readonly UnionSubpath[] }> = ({ regions }) => (
    <Shape
        listening={false}
        fill="#ffffff"
        sceneFunc={(ctx, shape) => {
            traceUnion(ctx, regions);
            // Apply the `fill` prop (raw ctx.fill() would use the default black).
            ctx.fillStrokeShape(shape);
        }}
    />
);

const GridLines: React.FC<{ w: hm; h: hm; step: hm }> = ({ w, h, step }) => {
    const lines: React.ReactNode[] = [];
    for (let x = step; x < w; x += step) {
        lines.push(
            <Line
                key={`gx-${x}`}
                points={[x, 0, x, h]}
                stroke={GRID_STROKE}
                strokeWidth={1}
                strokeScaleEnabled={false}
            />,
        );
    }
    for (let y = step; y < h; y += step) {
        lines.push(
            <Line
                key={`gy-${y}`}
                points={[0, y, w, y]}
                stroke={GRID_STROKE}
                strokeWidth={1}
                strokeScaleEnabled={false}
            />,
        );
    }
    return <>{lines}</>;
};

export interface SnapGuideLine {
    axis: 'x' | 'y';
    guide: number;
    extent: number;
}

interface OverlaysProps {
    doc: LabelDoc;
    guides: readonly Guide[];
    showGrid: boolean;
    gridStepHm: hm;
    snapLines: readonly SnapGuideLine[];
    /** Keep-out node ids, rendered with a small warn badge. */
    keepOutIds: readonly string[];
    /** World bounds of each keep-out node, for the badge position. */
    keepOutBounds: ReadonlyMap<string, { x: hm; y: hm; w: hm; h: hm }>;
    /** Viewport transform attrs, applied so overlays share the scene's space. */
    layerAttrs: {
        x: number;
        y: number;
        rotation: number;
        scaleX: number;
        scaleY: number;
        skewX: number;
    };
}

export const Overlays: React.FC<OverlaysProps> = ({
    doc,
    guides,
    showGrid,
    gridStepHm,
    snapLines,
    keepOutIds,
    keepOutBounds,
    layerAttrs,
}) => {
    const { regions } = resolveRegionOverlay(doc);
    const unionPaths = regionUnionPath(regions);
    return (
        <>
            <Layer listening={false} {...layerAttrs}>
                {unionPaths.length > 0 && <UnionSilhouette regions={unionPaths} />}
                {showGrid && <GridLines w={doc.label.backingW} h={doc.label.backingH} step={gridStepHm} />}
                {guides.map((guide) => (
                    <Line
                        key={guide.id}
                        points={[guide.line.x1, guide.line.y1, guide.line.x2, guide.line.y2]}
                        stroke={GUIDE_STROKE}
                        strokeWidth={1}
                        dash={[6, 4]}
                        listening={false}
                    />
                ))}
                {snapLines.map((line, index) => (
                    <Line
                        key={`snap-${index}`}
                        points={
                            line.axis === 'x'
                                ? [line.guide, 0, line.guide, line.extent]
                                : [0, line.guide, line.extent, line.guide]
                        }
                        stroke="#f43f5e"
                        strokeWidth={1}
                        dash={[4, 4]}
                        listening={false}
                    />
                ))}
                {keepOutIds.map((id) => {
                    const bounds = keepOutBounds.get(id);
                    if (!bounds) return null;
                    return (
                        <React.Fragment key={`warn-${id}`}>
                            <Rect
                                x={bounds.x}
                                y={bounds.y}
                                width={bounds.w}
                                height={bounds.h}
                                stroke="#f97316"
                                strokeWidth={1}
                                dash={[4, 4]}
                                listening={false}
                            />
                            <Text text="!" x={bounds.x + bounds.w + 4} y={bounds.y} fontSize={120} fill="#f97316" listening={false} />
                        </React.Fragment>
                    );
                })}
            </Layer>
        </>
    );
};

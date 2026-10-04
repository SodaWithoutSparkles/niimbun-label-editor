import React from 'react';
import { Ellipse, Group as KonvaGroup, Image as KonvaImage, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { fitImageAttrs, matrixToKonvaAttrs } from '../../editor/render/konvaFactory';
import type { AssetWarning, PreparedAsset } from '../../editor/render/assets';
import type { ResolvedNode } from '../../editor/render/resolve';

/**
 * Declarative react-konva renderer for `resolve(doc)` output. Transform math is
 * delegated to the shared factory (`matrixToKonvaAttrs`), so a node's on-screen
 * geometry matches the offscreen `konvaFactory` output exactly.
 *
 * Image / qr / barcode leaves draw the async-prepared raster from `assets`
 * (P5). A leaf with no prepared asset (missing resource, invalid payload, or a
 * not-yet-settled prepare) renders a labelled dashed placeholder box — never a
 * blank gap — and a leaf with an asset warning shows a small ⚠ badge.
 *
 * Nodes `listening={false}`: selection/drag are driven by the viewport engine's
 * hit test in `PreviewStage`, which is rotation/zoom-aware and unit-testable.
 */

interface ResolvedShapeProps {
    node: ResolvedNode;
    /** Register a node's ref so the Transformer can attach to it. */
    registerRef?: (id: string, node: Konva.Node | null) => void;
    /** Highlight styling for selected content. */
    selected?: boolean;
    /** Content outside the printable region gets a warn tint (keep-out). */
    warn?: boolean;
    /** Prepared rasters keyed by resolved node id (image / qr / barcode). */
    assets?: ReadonlyMap<string, PreparedAsset>;
    /** Per-leaf asset problems, for the ⚠ badge. */
    warnings?: ReadonlyMap<string, AssetWarning>;
    /** Human label for a placeholder box (asset name, or the node id). */
    assetLabels?: ReadonlyMap<string, string>;
}

const flatten = (points: readonly [number, number][]): number[] => {
    const out: number[] = [];
    for (const [x, y] of points) out.push(x, y);
    return out;
};

const strokeOf = (selected: boolean, warn: boolean): string | undefined => {
    if (selected) return '#3b82f6';
    if (warn) return '#f97316';
    return undefined;
};

/** Placeholder dash pattern, in hm — scaled with the box so it stays visible. */
const dashFor = (w: number): [number, number] => {
    const unit = Math.max(1, w);
    return [Math.max(60, Math.round(unit * 0.04)), Math.max(40, Math.round(unit * 0.03))];
};

/** Placeholder label size, in hm, clamped so it never dwarfs the box. */
const placeholderFontSize = (h: number): number => Math.max(60, Math.min(Math.round(h * 0.25), 400));

/** ⚠ badge size, in hm. */
const badgeFontSize = (w: number, h: number): number =>
    Math.max(80, Math.min(Math.round(Math.min(w, h) * 0.2), 300));

export const ResolvedShape = React.memo(function ResolvedShape({
    node,
    registerRef,
    selected = false,
    warn = false,
    assets,
    warnings,
    assetLabels,
}: ResolvedShapeProps) {
    const ref = (instance: Konva.Node | null) => registerRef?.(node.id, instance);

    if (node.type === 'group') {
        const attrs = matrixToKonvaAttrs(node.localTransform);
        return (
            <KonvaGroup ref={ref} {...attrs} listening={false}>
                {node.children.map((child) => (
                    <ResolvedShape
                        key={child.id}
                        node={child}
                        registerRef={registerRef}
                        selected={selected}
                        warn={warn}
                        assets={assets}
                        warnings={warnings}
                        assetLabels={assetLabels}
                    />
                ))}
            </KonvaGroup>
        );
    }

    const attrs = matrixToKonvaAttrs(node.localTransform);
    const stroke = strokeOf(selected, warn);

    switch (node.type) {
        case 'text':
            return (
                <Text
                    ref={ref}
                    {...attrs}
                    text={node.text}
                    width={node.w}
                    height={node.h}
                    fontSize={node.fontSize}
                    fontFamily={node.fontFamily}
                    fontStyle={node.fontStyle}
                    align={node.align}
                    padding={node.paddingHm}
                    listening={false}
                    fill={node.placeholder ? '#9ca3af' : '#111827'}
                    stroke={stroke}
                    strokeWidth={selected ? 1 : 0}
                />
            );
        case 'rectangle':
            return (
                <Rect
                    ref={ref}
                    {...attrs}
                    width={node.w}
                    height={node.h}
                    listening={false}
                    stroke={stroke ?? '#374151'}
                    strokeWidth={selected ? 2 : 1}
                />
            );
        case 'ellipse':
            return (
                <Ellipse
                    ref={ref}
                    {...attrs}
                    radiusX={node.rx}
                    radiusY={node.ry}
                    listening={false}
                    stroke={stroke ?? '#374151'}
                    strokeWidth={selected ? 2 : 1}
                />
            );
        case 'line':
        case 'polygon':
            return (
                <Line
                    ref={ref}
                    {...attrs}
                    points={flatten(node.points)}
                    closed={node.closed}
                    listening={false}
                    stroke={stroke ?? '#374151'}
                    strokeWidth={selected ? 2 : 1}
                />
            );
        case 'image':
        case 'qr':
        case 'barcode': {
            const asset = assets?.get(node.id);
            const assetWarning = warnings?.has(node.id) ?? false;
            if (asset) {
                const fit = node.type === 'image' ? node.fit : 'contain';
                const { crop, ...rect } = fitImageAttrs(
                    node.w,
                    node.h,
                    asset.widthPx,
                    asset.heightPx,
                    fit,
                );
                return (
                    <KonvaGroup ref={ref} {...attrs} listening={false}>
                        <KonvaImage image={asset.image} {...rect} {...(crop ? { crop } : {})} />
                        {assetWarning && (
                            <Text
                                text="⚠"
                                x={0}
                                y={0}
                                fontSize={badgeFontSize(node.w, node.h)}
                                fill="#f59e0b"
                            />
                        )}
                    </KonvaGroup>
                );
            }
            const label = assetLabels?.get(node.id) ?? node.id;
            return (
                <KonvaGroup ref={ref} {...attrs} listening={false}>
                    <Rect
                        width={node.w}
                        height={node.h}
                        stroke={stroke ?? '#9ca3af'}
                        strokeWidth={selected ? 2 : 1}
                        dash={dashFor(node.w)}
                    />
                    <Text
                        text={`${assetWarning ? '⚠ ' : ''}${label}`}
                        width={node.w}
                        height={node.h}
                        align="center"
                        verticalAlign="middle"
                        fontSize={placeholderFontSize(node.h)}
                        fill="#6b7280"
                    />
                </KonvaGroup>
            );
        }
    }
});

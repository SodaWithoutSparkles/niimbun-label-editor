import React from 'react';
import { Ellipse, Group as KonvaGroup, Image as KonvaImage, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import {
    fitImageAttrs,
    konvaTextWrap,
    matrixToKonvaAttrs,
    shapeStyleAttrs,
    symbolSceneFunc,
} from '../../editor/render/konvaFactory';
import { measureKonvaText } from '../../editor/render/textMetrics';
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
    /**
     * Screen px per hm — the viewport zoom (default 1). Shape strokes are drawn
     * with `strokeScaleEnabled={false}` so a live Transformer handle changes
     * geometry, not ink width. That flag also cancels the viewport-zoom Layer
     * scale, so the resolved hm width is multiplied by this to keep the on-screen
     * stroke identical to print (which scales hm by `dpi` instead).
     */
    strokeScale?: number;
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

/**
 * Placeholder dash pattern, in hm. The caller multiplies it by the same
 * `strokeScale * |attrs.scaleX|` factor as a shape stroke: the placeholder's
 * `strokeScaleEnabled={false}` makes Konva interpret the dash in device px, so
 * the raw hm values must be pre-multiplied to stay proportional to the box.
 */
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
    strokeScale = 1,
}: ResolvedShapeProps) {
    const ref = (instance: Konva.Node | null) => registerRef?.(node.id, instance);

    // Shrink-to-fit scale (P5). The hook runs unconditionally; the memo bails
    // for every node that is not `wrap: 'shrink'`, so a group⇄text switch can
    // never change the hook order.
    const shrinkScale = React.useMemo(() => {
        if (node.type !== 'text' || node.wrap !== 'shrink') return 1;
        return measureKonvaText({
            text: node.text,
            width: node.w,
            height: node.h,
            fontSize: node.fontSize,
            fontFamily: node.fontFamily,
            fontStyle: node.fontStyle,
            wrap: 'word',
            lineHeight: node.lineHeight,
            letterSpacing: node.letterSpacing,
        }).scale;
    }, [node]);

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
                        strokeScale={strokeScale}
                    />
                ))}
            </KonvaGroup>
        );
    }

    const attrs = matrixToKonvaAttrs(node.localTransform);
    const stroke = strokeOf(selected, warn);

    // Preview ink ignores the node's own scale during a gesture: a Transformer
    // handle changes the shape's *geometry*, not its line width, so the outline
    // must not thicken while a handle is dragged (it would snap back on commit).
    // `strokeScaleEnabled=false` is the mechanism; because it also cancels the
    // viewport-zoom Layer scale, shape strokes are pre-multiplied by
    // `strokeScale` (the zoom). The print path still scales the resolved hm
    // width by `dpi` *and* by the node's own committed `transform.scaleX`, so
    // the preview must pre-multiply that factor too for parity when
    // `|transform.scale| != 1` (reachable from the inspector scale sliders).
    // During a live drag `attrs` is decomposed from the doc transform, so
    // `attrs.scaleX` stays constant and the outline does not thicken mid-gesture.
    // A non-uniform node scale is approximated by the X factor; print renders an
    // elliptical stroke there (the preview's `strokeScaleEnabled=false` cannot).
    // Parity is also only approximate for a node nested under a scaled ancestor
    // group: the preview cancels that group scale while print composes it.
    const inkWidth = (hmWidth: number): number => hmWidth * strokeScale * Math.abs(attrs.scaleX);

    switch (node.type) {
        case 'text':
            return (
                <Text
                    ref={ref}
                    {...attrs}
                    // Shrink folds into the node's own transform scale; both
                    // renderers scale from the top-left origin (offset 0, which
                    // is Konva's default transform origin).
                    scaleX={attrs.scaleX * shrinkScale}
                    scaleY={attrs.scaleY * shrinkScale}
                    offsetX={0}
                    offsetY={0}
                    text={node.text}
                    width={node.w}
                    height={node.h}
                    fontSize={node.fontSize}
                    fontFamily={node.fontFamily}
                    fontStyle={node.fontStyle}
                    align={node.align}
                    padding={node.paddingHm}
                    wrap={konvaTextWrap(node.wrap)}
                    lineHeight={node.lineHeight}
                    letterSpacing={node.letterSpacing}
                    listening={false}
                    fill={node.placeholder ? '#9ca3af' : '#111827'}
                    stroke={stroke}
                    strokeWidth={selected ? 1 : 0}
                    // Selection outline only: constant screen width.
                    strokeScaleEnabled={false}
                />
            );
        case 'rectangle': {
            // Only the attrs the selection highlight does not override: `fill`
            // (`'transparent'` = no fill) and `cornerRadius`. `stroke`/
            // `strokeWidth` are set below.
            const { fill, cornerRadius } = shapeStyleAttrs(node);
            return (
                <Rect
                    ref={ref}
                    {...attrs}
                    width={node.w}
                    height={node.h}
                    listening={false}
                    fill={fill}
                    cornerRadius={cornerRadius}
                    // Editor affordance only: a selected/warn node overrides the
                    // visible stroke. The print factory never sees this highlight.
                    stroke={stroke ?? node.stroke}
                    strokeWidth={selected ? Math.max(inkWidth(node.strokeWidth), 2) : inkWidth(node.strokeWidth)}
                    strokeScaleEnabled={false}
                />
            );
        }
        case 'ellipse': {
            const { fill } = shapeStyleAttrs(node);
            return (
                <Ellipse
                    ref={ref}
                    {...attrs}
                    radiusX={node.rx}
                    radiusY={node.ry}
                    listening={false}
                    fill={fill}
                    stroke={stroke ?? node.stroke}
                    strokeWidth={selected ? Math.max(inkWidth(node.strokeWidth), 2) : inkWidth(node.strokeWidth)}
                    strokeScaleEnabled={false}
                />
            );
        }
        case 'line':
        case 'polygon': {
            const { fill } = shapeStyleAttrs(node);
            return (
                <Line
                    ref={ref}
                    {...attrs}
                    points={flatten(node.points)}
                    closed={node.closed}
                    listening={false}
                    fill={fill}
                    stroke={stroke ?? node.stroke}
                    strokeWidth={selected ? Math.max(inkWidth(node.strokeWidth), 2) : inkWidth(node.strokeWidth)}
                    strokeScaleEnabled={false}
                />
            );
        }
        case 'image':
        case 'qr':
        case 'barcode':
        case 'code': {
            const asset = assets?.get(node.id);
            const assetWarning = warnings?.has(node.id) ?? false;
            if (asset) {
                const fit =
                    node.type === 'image' ? node.fit : node.type === 'barcode' ? 'stretch' : 'contain';
                const { crop, ...rect } = fitImageAttrs(
                    node.w,
                    node.h,
                    asset.widthPx,
                    asset.heightPx,
                    fit,
                );
                return (
                    <KonvaGroup ref={ref} {...attrs} listening={false}>
                        {/* qr/barcode draw nearest-neighbour (option D) so upscaled
                            module edges stay hard; photos keep default smoothing. */}
                        <KonvaImage
                            image={asset.image}
                            {...rect}
                            {...(crop ? { crop } : {})}
                            {...(node.type !== 'image' ? { sceneFunc: symbolSceneFunc } : {})}
                        />
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
                        // The dash is in hm but, with `strokeScaleEnabled={false}`,
                        // Konva interprets it in device px — pre-multiply it by the
                        // same zoom × node-scale factor as a shape stroke so the
                        // pattern stays proportional to the box.
                        dash={dashFor(node.w).map((value) => value * strokeScale * Math.abs(attrs.scaleX)) as [number, number]}
                        // Placeholder affordance: constant screen width.
                        strokeScaleEnabled={false}
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

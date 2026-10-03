import React from 'react';
import { Ellipse, Group as KonvaGroup, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { matrixToKonvaAttrs } from '../../editor/render/konvaFactory';
import type { ResolvedNode } from '../../editor/render/resolve';

/**
 * Declarative react-konva renderer for `resolve(doc)` output. Transform math is
 * delegated to the shared factory (`matrixToKonvaAttrs`), so a node's on-screen
 * geometry matches the offscreen `konvaFactory` output exactly.
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

export const ResolvedShape = React.memo(function ResolvedShape({
    node,
    registerRef,
    selected = false,
    warn = false,
}: ResolvedShapeProps) {
    const ref = (instance: Konva.Node | null) => registerRef?.(node.id, instance);

    if (node.type === 'group') {
        const attrs = matrixToKonvaAttrs(node.localTransform);
        return (
            <KonvaGroup ref={ref} {...attrs} listening={false}>
                {node.children.map((child) => (
                    <ResolvedShape key={child.id} node={child} registerRef={registerRef} selected={selected} warn={warn} />
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
    }
});

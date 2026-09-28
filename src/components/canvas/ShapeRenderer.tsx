import React from 'react';
import { Rect, Circle, Line, Star, Arrow, Text as KonvaText, Image as KonvaImage, Transformer, Group } from 'react-konva';
import type { CanvasItem, ImageShape } from '../../types';
import { useStore } from '../../store/useStore';

interface ShapeRendererProps {
    item: CanvasItem;
    isSelected: boolean;
    dragEnabled?: boolean;
    onSelect: (e?: any) => void;
    onChange: (updates: Partial<CanvasItem>) => void;
    onDblClick?: () => void;
    onGroupDragStart?: () => void;
    onGroupDragMove?: (delta: { x: number; y: number }) => void;
    onGroupDragEnd?: () => void;
}

export const ShapeRenderer: React.FC<ShapeRendererProps> = ({
    item,
    isSelected,
    dragEnabled = true,
    onSelect,
    onChange,
    onDblClick,
    onGroupDragStart,
    onGroupDragMove,
    onGroupDragEnd
}) => {
    const shapeRef = React.useRef<any>(null);
    const trRef = React.useRef<any>(null);
    const [image, setImage] = React.useState<HTMLImageElement | null>(null);
    const [imageError, setImageError] = React.useState<boolean>(false);
    const dragPosRef = React.useRef<{ x: number; y: number } | null>(null);
    const lastAlertedSrcRef = React.useRef<string | null>(null);
    const addNotification = useStore((state) => state.addNotification);

    // Type guard for image items and a stable image src value for dependency arrays
    const isImage = (i: CanvasItem): i is ImageShape => i.type === 'image';
    const imageSrc = isImage(item) ? item.src : null;

    const formatImageSourceLabel = (src: string) => {
        if (src.startsWith('data:image/')) return 'Pasted image data';
        if (src.length > 140) return `${src.slice(0, 140)}…`;
        return src;
    };

    // Load image if item type is 'image'
    React.useEffect(() => {
        let active = true;
        if (item.type === 'image') {
            setImageError(false);
            console.log('Loading image:', item.src.substring(0, 100), '...');
            const img = new window.Image();
            img.crossOrigin = 'Anonymous';
            img.src = item.src;
            img.onload = () => {
                if (active) {
                    setImage(img);
                    setImageError(false);
                }
            };
            img.onerror = () => {
                console.error('Failed to load image:', item.src);
                if (active) {
                    setImageError(true);
                    setImage(null);
                }
            };
        } else {
            setImage(null);
            setImageError(false);
        }
        return () => {
            active = false;
        };
    }, [item.type, imageSrc]);

    React.useEffect(() => {
        if (item.type !== 'image') {
            lastAlertedSrcRef.current = null;
            return;
        }
        if (!imageError) {
            lastAlertedSrcRef.current = null;
            return;
        }
        if (item.src && lastAlertedSrcRef.current !== item.src) {
            lastAlertedSrcRef.current = item.src;
            console.error('Image failed to load for item.src:', item.src);
            addNotification({
                type: 'error',
                title: 'Image Load Failed',
                message: 'Unable to load the image. This may be caused by CORS restrictions or the resource being unavailable.',
                detail: formatImageSourceLabel(item.src)
            });
        }
    }, [imageError, imageSrc, item.type, addNotification]);
    React.useEffect(() => {
        if (isSelected && trRef.current && shapeRef.current) {
            trRef.current.nodes([shapeRef.current]);
            trRef.current.getLayer().batchDraw();
        }
    }, [isSelected, image, imageError]);

    const handleDragStart = (e: any) => {
        if (!dragEnabled) return;
        if (!onGroupDragMove) return;
        dragPosRef.current = { x: e.target.x(), y: e.target.y() };
        onGroupDragStart?.();
    };

    const handleDragMove = (e: any) => {
        if (!dragEnabled) return;
        if (!onGroupDragMove) return;
        const prev = dragPosRef.current ?? { x: item.x, y: item.y };
        const next = { x: e.target.x(), y: e.target.y() };
        const delta = { x: next.x - prev.x, y: next.y - prev.y };
        dragPosRef.current = next;
        onGroupDragMove(delta);
    };

    const handleDragEnd = (e: any) => {
        if (!dragEnabled) return;
        const nextX = e.target.x();
        const nextY = e.target.y();

        if (onGroupDragMove) {
            dragPosRef.current = null;
            onGroupDragEnd?.();
            return;
        }

        onChange({
            x: nextX,
            y: nextY
        });
    };

    const handleTransformEnd = () => {
        const node = shapeRef.current;
        if (!node) return;

        const scaleX = node.scaleX();
        const scaleY = node.scaleY();

        // Reset scale
        node.scaleX(1);
        node.scaleY(1);

        // Update item with new dimensions
        if (item.type === 'rectangle') {
            onChange({
                x: node.x(),
                y: node.y(),
                width: Math.max(5, node.width() * scaleX),
                height: Math.max(5, node.height() * scaleY),
                rotation: node.rotation()
            });
        } else if (item.type === 'ellipse') {
            onChange({
                x: node.x(),
                y: node.y(),
                radiusX: Math.max(5, item.radiusX * scaleX),
                radiusY: Math.max(5, item.radiusY * scaleY),
                rotation: node.rotation()
            });
        } else if (item.type === 'star') {
            onChange({
                x: node.x(),
                y: node.y(),
                innerRadius: Math.max(5, item.innerRadius * scaleX),
                outerRadius: Math.max(5, item.outerRadius * scaleX),
                rotation: node.rotation()
            });
        } else if (item.type === 'text') {
            // For text, only scale the bounding box, not the font size
            onChange({
                x: node.x(),
                y: node.y(),
                rotation: node.rotation(),
                width: Math.max(20, item.width * scaleX),
                height: Math.max(20, item.height * scaleY)
                // fontSize stays the same - don't scale it
            });
        } else if (item.type === 'image') {
            onChange({
                x: node.x(),
                y: node.y(),
                rotation: node.rotation(),
                width: Math.max(10, item.width * scaleX),
                height: Math.max(10, item.height * scaleY)
            });
        } else {
            onChange({
                x: node.x(),
                y: node.y(),
                rotation: node.rotation()
            });
        }
    };

    const commonProps = {
        ref: shapeRef,
        draggable: item.draggable && dragEnabled,
        x: item.x,
        y: item.y,
        rotation: item.rotation,
        stroke: item.stroke,
        strokeWidth: item.strokeWidth,
        fill: item.fill,
        opacity: item.opacity,
        onClick: onSelect,
        onTap: onSelect,
        onDragEnd: handleDragEnd,
        onDragStart: handleDragStart,
        onDragMove: handleDragMove,
        onTransformEnd: handleTransformEnd,
        onDblClick: onDblClick
    };

    let shape = null;

    switch (item.type) {
        case 'rectangle':
            shape = (
                <Rect
                    {...commonProps}
                    width={item.width}
                    height={item.height}
                />
            );
            break;

        case 'ellipse':
            shape = (
                <Circle
                    {...commonProps}
                    radius={Math.max(item.radiusX, item.radiusY)}
                    scaleX={item.radiusX / Math.max(item.radiusX, item.radiusY)}
                    scaleY={item.radiusY / Math.max(item.radiusX, item.radiusY)}
                />
            );
            break;

        case 'line':
            shape = (
                <Line
                    {...commonProps}
                    points={item.points.flatMap(p => [p.x, p.y])}
                    closed={item.closed}
                    tension={0.3}
                />
            );
            break;

        case 'star':
            shape = (
                <Star
                    {...commonProps}
                    numPoints={item.numPoints}
                    innerRadius={item.innerRadius}
                    outerRadius={item.outerRadius}
                />
            );
            break;

        case 'arrow':
            shape = (
                <Arrow
                    {...commonProps}
                    points={item.points.flatMap(p => [p.x, p.y])}
                    pointerLength={item.pointerLength}
                    pointerWidth={item.pointerWidth}
                />
            );
            break;

        case 'text':
            shape = (
                <Group
                    {...commonProps}
                >
                    {/* Background Box */}
                    <Rect
                        width={item.width}
                        height={item.height}
                        fill={item.fill}
                        stroke={item.stroke}
                        strokeWidth={item.strokeWidth}
                        shadowBlur={0}
                    />
                    {/* Text Content */}
                    <KonvaText
                        x={0}
                        y={0}
                        width={item.width}
                        height={item.height}
                        text={item.text}
                        fontSize={item.fontSize}
                        fontFamily={item.fontFamily}
                        fontStyle={[item.fontStyle, item.fontWeight].filter(Boolean).join(' ') || 'normal'}
                        align={item.align}
                        verticalAlign="top"
                        fill={item.textColor ?? item.stroke}
                        padding={5}
                    />
                </Group>
            );
            break;

        case 'image':
            if (image) {
                shape = (
                    <KonvaImage
                        {...commonProps}
                        image={image}
                        width={item.width}
                        height={item.height}
                    />
                );
            } else {
                const isError = imageError;
                const displayText = isError ? "Image Load Error\n(CORS/404)" : "Loading Image...";
                const strokeColor = isError ? "red" : "#999";
                const bgColor = isError ? "#ffe6e6" : "#f0f0f0";

                shape = (
                    <Group {...commonProps}>
                        <Rect
                            width={item.width}
                            height={item.height}
                            fill={bgColor}
                            stroke={strokeColor}
                            strokeWidth={1}
                            dash={isError ? undefined : [5, 5]}
                        />
                        <KonvaText
                            text={displayText}
                            width={item.width}
                            height={item.height}
                            align="center"
                            verticalAlign="middle"
                            fill={strokeColor}
                            padding={5}
                            fontSize={Math.min(item.height / 5, item.width / 10)}
                        />
                    </Group>
                );
            }
            break;

        default:
            return null;
    }

    return (
        <>
            {shape}
            {isSelected && <Transformer ref={trRef} />}
        </>
    );
};

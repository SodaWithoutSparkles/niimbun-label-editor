import type { CanvasItem } from '../../../types';

export const normalizeTextShape = (
    shape: Extract<CanvasItem, { type: 'text' }>
): Extract<CanvasItem, { type: 'text' }> => {
    let { x, y, width, height } = shape;

    if (width < 0) {
        x += width;
        width = Math.abs(width);
    }

    if (height < 0) {
        y += height;
        height = Math.abs(height);
    }

    return { ...shape, x, y, width, height };
};

export const createShape = (
    activeTool: string,
    localPos: { x: number; y: number },
    colors: { stroke: string; fill: string },
    toolSettings: any
): CanvasItem | null => {
    const id = Math.random().toString(36).slice(2, 11);

    switch (activeTool) {
        case 'rectangle':
            return {
                id,
                type: 'rectangle',
                x: localPos.x,
                y: localPos.y,
                width: 0,
                height: 0,
                rotation: 0,
                stroke: colors.stroke,
                strokeWidth: toolSettings.lineWidth,
                fill: colors.fill,
                opacity: 1,
                draggable: true
            };

        case 'text':
            return {
                id,
                type: 'text',
                x: localPos.x,
                y: localPos.y,
                width: 0,
                height: 0,
                text: '',
                fontSize: toolSettings.fontSize,
                fontFamily: toolSettings.fontFamily,
                fontStyle: toolSettings.fontStyle,
                fontWeight: toolSettings.fontWeight,
                align: toolSettings.textAlign,
                textColor: toolSettings.textColor,
                rotation: 0,
                fill: colors.fill,
                stroke: colors.stroke,
                strokeWidth: toolSettings.lineWidth,
                opacity: 1,
                draggable: true
            };

        case 'ellipse':
            return {
                id,
                type: 'ellipse',
                x: localPos.x,
                y: localPos.y,
                radiusX: 0,
                radiusY: 0,
                rotation: 0,
                stroke: colors.stroke,
                strokeWidth: toolSettings.lineWidth,
                fill: colors.fill,
                opacity: 1,
                draggable: true
            };

        case 'line':
            return {
                id,
                type: 'line',
                x: 0,
                y: 0,
                points: [{ x: localPos.x, y: localPos.y }],
                closed: false,
                rotation: 0,
                stroke: colors.stroke,
                strokeWidth: toolSettings.lineWidth,
                fill: 'transparent',
                opacity: 1,
                draggable: true
            };

        case 'arrow':
            return {
                id,
                type: 'arrow',
                x: 0,
                y: 0,
                points: [{ x: localPos.x, y: localPos.y }, { x: localPos.x, y: localPos.y }],
                pointerLength: 10,
                pointerWidth: 10,
                rotation: 0,
                stroke: colors.stroke,
                strokeWidth: toolSettings.lineWidth,
                fill: colors.stroke,
                opacity: 1,
                draggable: true
            };

        case 'star':
            return {
                id,
                type: 'star',
                x: localPos.x,
                y: localPos.y,
                numPoints: 5,
                innerRadius: 0,
                outerRadius: 0,
                rotation: 0,
                stroke: colors.stroke,
                strokeWidth: toolSettings.lineWidth,
                fill: colors.fill,
                opacity: 1,
                draggable: true
            };

        default:
            return null;
    }
};

export const updateShapeWhileDrawing = (
    currentShape: CanvasItem,
    localPos: { x: number; y: number },
    isModifierPressed: boolean,
    isPolylineMode: boolean
): CanvasItem => {
    void isPolylineMode;
    const constrainTo45 = (start: { x: number; y: number }, end: { x: number; y: number }) => {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        if (dx === 0 && dy === 0) return end;

        const angle = Math.atan2(dy, dx);
        const snap = Math.PI / 4;
        const snappedAngle = Math.round(angle / snap) * snap;
        const distance = Math.hypot(dx, dy);

        return {
            x: start.x + Math.cos(snappedAngle) * distance,
            y: start.y + Math.sin(snappedAngle) * distance
        };
    };

    switch (currentShape.type) {
        case 'rectangle':
        case 'text': {
            const rectShape = currentShape as Extract<CanvasItem, { type: 'rectangle' | 'text' }>;
            let width = localPos.x - currentShape.x;
            let height = localPos.y - currentShape.y;

            if (isModifierPressed) {
                const size = Math.max(Math.abs(width), Math.abs(height));
                width = width >= 0 ? size : -size;
                height = height >= 0 ? size : -size;
            }

            return { ...rectShape, width, height };
        }

        case 'ellipse': {
            const ellipseShape = currentShape as Extract<CanvasItem, { type: 'ellipse' }>;
            let radiusX = Math.abs(localPos.x - currentShape.x);
            let radiusY = Math.abs(localPos.y - currentShape.y);

            if (isModifierPressed) {
                const radius = Math.max(radiusX, radiusY);
                radiusX = radius;
                radiusY = radius;
            }

            return { ...ellipseShape, radiusX, radiusY };
        }

        case 'line': {
            const lineShape = currentShape as Extract<CanvasItem, { type: 'line' }>;
            const points = lineShape.points ?? [];
            const startPoint = points.length > 1
                ? points[points.length - 2]
                : points[0] ?? localPos;

            let nextEnd = { x: localPos.x, y: localPos.y };
            if (isModifierPressed && points.length > 0) {
                nextEnd = constrainTo45(startPoint, nextEnd);
            }

            const nextPoints = points.length <= 1
                ? [startPoint, nextEnd]
                : [...points.slice(0, -1), nextEnd];

            return {
                ...lineShape,
                points: nextPoints
            };
        }

        case 'arrow': {
            const arrowShape = currentShape as Extract<CanvasItem, { type: 'arrow' }>;
            const points = arrowShape.points ?? [];
            const startPoint = points.length > 1
                ? points[points.length - 2]
                : points[0] ?? localPos;

            let nextEnd = { x: localPos.x, y: localPos.y };
            if (isModifierPressed && points.length > 0) {
                nextEnd = constrainTo45(startPoint, nextEnd);
            }

            const nextPoints = points.length <= 1
                ? [startPoint, nextEnd]
                : [...points.slice(0, -1), nextEnd];

            return {
                ...arrowShape,
                points: nextPoints
            };
        }

        case 'star': {
            const starShape = currentShape as Extract<CanvasItem, { type: 'star' }>;
            const radius = Math.sqrt(
                Math.pow(localPos.x - currentShape.x, 2) + Math.pow(localPos.y - currentShape.y, 2)
            );
            return {
                ...starShape,
                innerRadius: radius * 0.5,
                outerRadius: radius
            };
        }

        default:
            return currentShape;
    }
};

export const shouldAddShape = (shape: CanvasItem): boolean => {
    switch (shape.type) {
        case 'rectangle': {
            const rectShape = shape as Extract<CanvasItem, { type: 'rectangle' }>;
            return Math.abs(rectShape.width) > 5 && Math.abs(rectShape.height) > 5;
        }
        case 'ellipse': {
            const ellipseShape = shape as Extract<CanvasItem, { type: 'ellipse' }>;
            return ellipseShape.radiusX > 5 && ellipseShape.radiusY > 5;
        }
        case 'star': {
            const starShape = shape as Extract<CanvasItem, { type: 'star' }>;
            return starShape.outerRadius > 5;
        }
        case 'line':
        case 'arrow': {
            const lineShape = shape as Extract<CanvasItem, { type: 'line' | 'arrow' }>;
            return lineShape.points.length >= 2;
        }
        case 'text': {
            const textShape = shape as Extract<CanvasItem, { type: 'text' }>;
            return Math.abs(textShape.width) > 5 && Math.abs(textShape.height) > 5;
        }
        default:
            return false;
    }
};

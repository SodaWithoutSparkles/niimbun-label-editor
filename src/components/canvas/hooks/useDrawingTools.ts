import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';
import type { CanvasItem } from '../../../types';
import { createShape, updateShapeWhileDrawing, shouldAddShape, normalizeTextShape } from '../utils/shapeHelpers';
import { useKeyboardModifiers } from './useKeyboardModifiers';

type ModifierKey = 'ctrl' | 'alt' | 'shift';

export const useDrawingTools = (
    activeTool: string,
    colors: { stroke: string; fill: string; active: string },
    toolSettings: any,
    isDropperActive: boolean,
    setColors: (colors: any) => void,
    setDropperActive: (active: boolean) => void,
    addItem: (item: CanvasItem) => void,
    stageRef: RefObject<any>,
    onTextShapeComplete?: (shape: Extract<CanvasItem, { type: 'text' }>) => void,
    modifierKey: ModifierKey = 'ctrl',
    cancelKey: string = 'Escape'
) => {
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentShapes, setCurrentShapes] = useState<CanvasItem[]>([]);
    const [isPolylineMode, setIsPolylineMode] = useState(false);
    const [calloutPhase, setCalloutPhase] = useState<'box' | 'arrow'>('box');
    const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
    const { isModifierPressed } = useKeyboardModifiers(modifierKey);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== ' ') return;
            if (!isDrawing) return;

            const anchor = lastPointerRef.current;
            if (!anchor) return;

            if (activeTool === 'arrow' || activeTool === 'line') {
                e.preventDefault();
                setCurrentShapes((prev) => {
                    const shape = prev[0];
                    if (!shape || (shape.type !== 'arrow' && shape.type !== 'line')) return prev;

                    const points = shape.points ?? [];
                    const nextPoints = points.length === 0
                        ? [{ x: anchor.x, y: anchor.y }, { x: anchor.x, y: anchor.y }]
                        : [...points, { x: anchor.x, y: anchor.y }];

                    return [{
                        ...shape,
                        points: nextPoints
                    }];
                });
                setIsPolylineMode(true);
                return;
            }

            if (activeTool === 'callout') {
                e.preventDefault();
                if (calloutPhase === 'box') {
                    setCurrentShapes((prev) => {
                        const textShape = prev.find((shape) => shape.type === 'text');
                        const updatedText = textShape
                            ? updateShapeWhileDrawing(textShape, anchor, isModifierPressed, false)
                            : null;
                        const arrowShape = createShape('arrow', anchor, colors, toolSettings);

                        const nextShapes: CanvasItem[] = [];
                        if (updatedText) nextShapes.push(updatedText);
                        if (arrowShape) nextShapes.push(arrowShape);
                        return nextShapes;
                    });

                    setCalloutPhase('arrow');
                } else {
                    setCurrentShapes((prev) => {
                        const textShape = prev.find((shape) => shape.type === 'text');
                        const arrowShape = prev.find((shape) => shape.type === 'arrow');
                        if (!arrowShape) return prev;

                        const points = arrowShape.points ?? [];
                        const nextPoints = points.length === 0
                            ? [{ x: anchor.x, y: anchor.y }, { x: anchor.x, y: anchor.y }]
                            : [...points, { x: anchor.x, y: anchor.y }];

                        const nextShapes: CanvasItem[] = [];
                        if (textShape) nextShapes.push(textShape);
                        nextShapes.push({
                            ...arrowShape,
                            points: nextPoints
                        });
                        return nextShapes;
                    });
                    setIsPolylineMode(true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeTool, calloutPhase, colors, isModifierPressed, isDrawing, toolSettings]);

    useEffect(() => {
        const handleCancel = (e: KeyboardEvent) => {
            if (e.key !== cancelKey) return;
            if (!isDrawing) return;
            e.preventDefault();
            setIsDrawing(false);
            setCurrentShapes([]);
            setIsPolylineMode(false);
            setCalloutPhase('box');
        };

        window.addEventListener('keydown', handleCancel);
        return () => window.removeEventListener('keydown', handleCancel);
    }, [cancelKey, isDrawing]);

    const handleMouseDown = useCallback((e: any) => {
        // Handle color picker
        if (isDropperActive) {
            const shape = e.target;
            if (shape && shape.attrs && (shape.attrs.stroke || shape.attrs.fill)) {
                const pickedColor = colors.active === 'stroke' ? shape.attrs.stroke : shape.attrs.fill;
                if (pickedColor) {
                    setColors({ [colors.active]: pickedColor });
                    setDropperActive(false);
                }
            }
            return;
        }

        if (activeTool === 'select') return;

        const stage = stageRef.current;
        const pos = stage.getPointerPosition();
        const transform = stage.getAbsoluteTransform().copy().invert();
        const localPos = transform.point(pos);
        lastPointerRef.current = localPos;

        setIsDrawing(true);

        if (activeTool === 'callout') {
            const textShape = createShape('text', localPos, colors, toolSettings);
            if (textShape) {
                setCurrentShapes([textShape]);
                setCalloutPhase('box');
            }
            return;
        }

        const newShape = createShape(activeTool, localPos, colors, toolSettings);

        if (newShape) {
            setCurrentShapes([newShape]);
        }
    }, [activeTool, colors, toolSettings, isDropperActive, setColors, setDropperActive, stageRef]);

    const handleMouseMove = useCallback(() => {
        if (!isDrawing || currentShapes.length === 0) return;

        const stage = stageRef.current;
        const pos = stage.getPointerPosition();
        const transform = stage.getAbsoluteTransform().copy().invert();
        const localPos = transform.point(pos);
        lastPointerRef.current = localPos;

        if (activeTool === 'callout') {
            if (calloutPhase === 'box') {
                const textShape = currentShapes.find((shape) => shape.type === 'text');
                if (!textShape) return;

                const updatedText = updateShapeWhileDrawing(
                    textShape,
                    localPos,
                    isModifierPressed,
                    false
                );

                setCurrentShapes([updatedText]);
                return;
            }

            const textShape = currentShapes.find((shape) => shape.type === 'text');
            const arrowShape = currentShapes.find((shape) => shape.type === 'arrow');
            if (!textShape || !arrowShape) return;

            const updatedArrow = updateShapeWhileDrawing(
                arrowShape,
                localPos,
                isModifierPressed,
                isPolylineMode
            );

            setCurrentShapes([textShape, updatedArrow]);

            if (isPolylineMode) {
                setIsPolylineMode(false);
            }
            return;
        }

        const updatedShape = updateShapeWhileDrawing(
            currentShapes[0],
            localPos,
            isModifierPressed,
            isPolylineMode
        );

        setCurrentShapes([updatedShape]);

        if (isPolylineMode) {
            setIsPolylineMode(false);
        }
    }, [activeTool, calloutPhase, currentShapes, isModifierPressed, isDrawing, isPolylineMode, stageRef]);

    const handleMouseUp = useCallback(() => {
        if (isDrawing && currentShapes.length > 0) {
            if (activeTool === 'callout') {
                const textShape = currentShapes.find((shape) => shape.type === 'text') as Extract<CanvasItem, { type: 'text' }> | undefined;
                const arrowShape = currentShapes.find((shape) => shape.type === 'arrow');

                if (textShape && Math.abs(textShape.width) > 5 && Math.abs(textShape.height) > 5) {
                    const normalizedText = normalizeTextShape(textShape);
                    addItem(normalizedText);
                    onTextShapeComplete?.(normalizedText);
                }
                if (arrowShape && shouldAddShape(arrowShape)) {
                    addItem(arrowShape);
                }
            } else {
                const shape = currentShapes[0];
                if (shape && shouldAddShape(shape)) {
                    if (shape.type === 'text') {
                        const normalizedText = normalizeTextShape(shape);
                        addItem(normalizedText);
                        onTextShapeComplete?.(normalizedText);
                    } else {
                        addItem(shape);
                    }
                }
            }
        }

        setIsDrawing(false);
        setCurrentShapes([]);
        setIsPolylineMode(false);
        setCalloutPhase('box');
    }, [activeTool, isDrawing, currentShapes, addItem, onTextShapeComplete]);

    return {
        isDrawing,
        currentShapes,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp
    };
};

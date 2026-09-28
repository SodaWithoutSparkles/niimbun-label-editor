import { useState, useCallback, type RefObject } from 'react';
import type { CanvasItem } from '../../../types';

interface EditingTextState {
    id?: string;
    x: number;
    y: number;
    stageX: number;
    stageY: number;
    width: number;
    height: number;
    text: string;
    rotation: number;
    fontSize: number;
    fontFamily: string;
    fill: string;
    stroke: string;
    textColor: string;
}

export const useTextEditor = (
    stageRef: RefObject<any>,
    stageScale: number,
    toolSettings: any,
    updateItem: (id: string, updates: Partial<CanvasItem>) => void,
    addItem: (item: CanvasItem) => void
) => {
    const [editingText, setEditingText] = useState<EditingTextState | null>(null);

    const handleShapeDblClick = useCallback((item: CanvasItem) => {
        if (item.type === 'text') {
            const stage = stageRef.current;
            const textItem = item as any;

            let stageX = item.x;
            let stageY = item.y;
            let width = textItem.width;
            let height = textItem.height;

            if (width < 0) {
                stageX += width;
                width = Math.abs(width);
            }

            if (height < 0) {
                stageY += height;
                height = Math.abs(height);
            }

            const tr = stage.getAbsoluteTransform();
            const absPos = tr.point({ x: stageX, y: stageY });

            setEditingText({
                id: item.id,
                x: absPos.x,
                y: absPos.y,
                stageX,
                stageY,
                width,
                height,
                text: textItem.text,
                rotation: item.rotation,
                fontSize: textItem.fontSize,
                fontFamily: textItem.fontFamily,
                fill: textItem.fill,
                stroke: textItem.stroke,
                textColor: textItem.textColor ?? textItem.stroke
            });
        }
    }, [stageRef]);

    const handleTextComplete = useCallback(() => {
        if (editingText) {
            if (editingText.text.trim()) {
                if (editingText.id) {
                    updateItem(editingText.id, {
                        text: editingText.text
                    });
                } else {
                    const id = Math.random().toString(36).slice(2, 11);
                    const newText: CanvasItem = {
                        id,
                        type: 'text',
                        x: editingText.stageX,
                        y: editingText.stageY,
                        width: editingText.width,
                        height: editingText.height,
                        text: editingText.text,
                        fontSize: editingText.fontSize,
                        fontFamily: editingText.fontFamily,
                        fontStyle: toolSettings.fontStyle,
                        fontWeight: toolSettings.fontWeight,
                        align: toolSettings.textAlign,
                        rotation: editingText.rotation,
                        fill: editingText.fill,
                        stroke: editingText.stroke,
                        textColor: editingText.textColor,
                        strokeWidth: toolSettings.lineWidth,
                        opacity: 1,
                        draggable: true
                    };
                    addItem(newText);
                }
            } else if (editingText.id) {
                updateItem(editingText.id, { text: '' });
            }
            setEditingText(null);
        }
    }, [editingText, toolSettings, updateItem, addItem]);

    const handleTextCancel = useCallback(() => {
        if (editingText) {
            setEditingText(null);
        }
    }, [editingText]);

    const startTextEditing = useCallback((
        stageX: number,
        stageY: number,
        width: number,
        height: number,
        text: string,
        fontSize: number,
        fontFamily: string,
        fill: string,
        stroke: string,
        rotation: number,
        textColor: string,
        id?: string
    ) => {
        const stage = stageRef.current;
        const tr = stage.getAbsoluteTransform();
        const absPos = tr.point({ x: stageX, y: stageY });

        setEditingText({
            id,
            x: absPos.x,
            y: absPos.y,
            stageX,
            stageY,
            width,
            height,
            text,
            rotation,
            fontSize,
            fontFamily,
            fill,
            stroke,
            textColor
        });
    }, [stageRef]);

    return {
        editingText,
        setEditingText,
        handleShapeDblClick,
        handleTextComplete,
        handleTextCancel,
        startTextEditing,
        stageScale
    };
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer } from 'react-konva';
import { useStore } from '../../store/useStore';
import { ShapeRenderer } from './ShapeRenderer';
import { TextEditorOverlay } from './TextEditorOverlay';
import { useCanvasExport } from './hooks/useCanvasExport';
import { useCanvasNavigation } from './hooks/useCanvasNavigation';
import { useCanvasDimensions } from './hooks/useCanvasDimensions';
import { useDrawingTools } from './hooks/useDrawingTools';
import { useTextEditor } from './hooks/useTextEditor';

export const DrawingCanvas: React.FC<{ readOnly?: boolean }> = ({ readOnly = false }) => {
    // Store state
    const objects = useStore((state) => state.objects);
    const selectedIds = useStore((state) => state.selectedIds);
    const selectItem = useStore((state) => state.selectItem);
    const toggleSelectItem = useStore((state) => state.toggleSelectItem);
    const updateItem = useStore((state) => state.updateItem);
    const moveItemsByDeltaTransient = useStore((state) => state.moveItemsByDeltaTransient);
    const commitHistory = useStore((state) => state.commitHistory);
    const addItem = useStore((state) => state.addItem);
    const activeTool = useStore((state) => state.activeTool);
    const colors = useStore((state) => state.colors);
    const setColors = useStore((state) => state.setColors);
    const projectName = useStore((state) => state.projectName);
    const isDropperActive = useStore((state) => state.isDropperActive);
    const setDropperActive = useStore((state) => state.setDropperActive);
    const toolSettings = useStore((state) => state.toolSettings);
    const exportTrigger = useStore((state) => state.exportTrigger);
    const keyboardShortcuts = useStore((state) => state.keyboardShortcuts);
    const setCanvasPosition = useStore((state) => state.setCanvasPosition);
    const homeViewTrigger = useStore((state) => state.homeViewTrigger);
    const addNotification = useStore((state) => state.addNotification);

    // Refs
    const stageRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const trRef = useRef<any>(null);
    const groupDragSnapshotRef = useRef<typeof objects | null>(null);
    const dragCounterRef = useRef(0);
    const [isDraggingImage, setIsDraggingImage] = useState(false);

    // Custom hooks
    const dimensions = useCanvasDimensions(containerRef);
    const { stagePos, setStagePos, handleWheel, handleTouchMove, handleTouchEnd } = useCanvasNavigation(stageRef);
    const {
        editingText,
        setEditingText,
        handleShapeDblClick,
        handleTextComplete,
        handleTextCancel,
        startTextEditing
    } = useTextEditor(
        stageRef,
        stagePos.scale,
        toolSettings,
        updateItem,
        addItem
    );

    const {
        currentShapes,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp
    } = useDrawingTools(
        activeTool,
        colors,
        toolSettings,
        isDropperActive,
        setColors,
        setDropperActive,
        addItem,
        stageRef,
        (shape) => {
            startTextEditing(
                shape.x,
                shape.y,
                shape.width,
                shape.height,
                shape.text,
                shape.fontSize,
                shape.fontFamily,
                shape.fill,
                shape.stroke,
                shape.rotation,
                shape.textColor ?? shape.stroke,
                shape.id
            );
        },
        keyboardShortcuts.modifyKey,
        keyboardShortcuts.cancelKey
    );

    const exportOptions = useMemo(() => ({
        filename: projectName
    }), [projectName]);

    useCanvasExport(exportTrigger, stageRef, trRef, exportOptions);

    // Sync stagePos to store
    useEffect(() => {
        setCanvasPosition(stagePos);
    }, [stagePos, setCanvasPosition]);

    // Handle home view trigger — center the canvas origin in the viewport.
    useEffect(() => {
        if (homeViewTrigger > 0 && containerRef.current) {
            const stageW = containerRef.current.offsetWidth;
            const stageH = containerRef.current.offsetHeight;
            setStagePos({ x: stageW / 2, y: stageH / 2, scale: 1 });
        }
    }, [homeViewTrigger, containerRef, setStagePos]);

    const handleStageDragMove = (e: any) => {
        if (e.target === stageRef.current) {
            setStagePos({
                x: e.target.x(),
                y: e.target.y(),
                scale: stageRef.current.scaleX()
            });
        }
    };

    const handleStageClick = (e: any) => {
        if (e.target === e.target.getStage()) {
            selectItem(null);
        }
    };

    const isLikelyImageUrl = (url: string) => {
        if (!url) return false;
        if (url.startsWith('data:image/')) return true;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?(#.*)?$/i.test(url);
        }
        return false;
    };

    const extractImageUrl = (dataTransfer: DataTransfer) => {
        const uriList = dataTransfer.getData('text/uri-list');
        if (uriList) {
            const first = uriList.split('\n')[0].trim();
            if (isLikelyImageUrl(first)) return first;
        }

        const html = dataTransfer.getData('text/html');
        if (html) {
            const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (match?.[1] && isLikelyImageUrl(match[1])) return match[1];
        }

        const text = dataTransfer.getData('text/plain');
        if (text && isLikelyImageUrl(text.trim())) return text.trim();

        return null;
    };

    const formatImageSourceLabel = (src: string) => {
        if (src.startsWith('data:image/')) return 'Pasted image data';
        if (src.length > 50) return `${src.slice(0, 50)}…`;
        return src;
    };

    const addImageAt = (src: string, dropX: number, dropY: number) => {
        console.log('Adding image to:', dropX, dropY);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const isExternal = src.startsWith('http://') || src.startsWith('https://');
        const shouldResize = isExternal;
        console.log('Downloading image from', isExternal ? 'external URL' : 'data URL');
        img.onload = () => {
            const maxWidth = dimensions.width * 0.5;
            const maxHeight = dimensions.height * 0.5;
            const maxSize = 400;

            const scale = shouldResize
                ? Math.min(1, maxWidth / img.width, maxHeight / img.height)
                : Math.min(1, maxSize / Math.max(img.width, img.height));
            const width = Math.round(img.width * scale);
            const height = Math.round(img.height * scale);

            addItem({
                id: Math.random().toString(36).substring(2, 9),
                type: 'image',
                x: dropX,
                y: dropY,
                rotation: 0,
                stroke: 'transparent',
                strokeWidth: 0,
                fill: 'transparent',
                opacity: 1,
                draggable: true,
                width,
                height,
                src
            });
        };
        img.onerror = (err) => {
            console.error('Failed to load image:', src, err);
            // Inform the user and don't add a broken image to the canvas.
            addNotification({
                type: 'error',
                title: 'Image Load Failed',
                message: 'Unable to load the image. This may be caused by CORS restrictions or the resource being unavailable. You can try copy and pasting the image directly instead.',
                detail: `From: ${formatImageSourceLabel(src)}`
            });
        };
        img.src = src;
    };

    const addImageCentered = (src: string) => {
        const centerX = (dimensions.width / 2 - stagePos.x) / stagePos.scale;
        const centerY = (dimensions.height / 2 - stagePos.y) / stagePos.scale;
        addImageAt(src, centerX, centerY);
    };

    const isImageDrag = (e: React.DragEvent<HTMLDivElement>) => {
        const items = Array.from(e.dataTransfer.items || []);
        const hasImageFile = items.some(item => item.kind === 'file' && item.type.startsWith('image/'));
        if (hasImageFile) return true;
        const url = extractImageUrl(e.dataTransfer);
        return !!url;
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        if (!isImageDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    };

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        if (!isImageDrag(e)) return;
        e.preventDefault();
        dragCounterRef.current += 1;
        setIsDraggingImage(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        if (!isDraggingImage) return;
        if (!isImageDrag(e)) return;
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) {
            setIsDraggingImage(false);
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        if (readOnly) return;
        if (!isImageDrag(e)) return;
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDraggingImage(false);

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;
        const dropX = (clientX - stagePos.x) / stagePos.scale;
        const dropY = (clientY - stagePos.y) / stagePos.scale;

        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const src = event.target?.result as string;
                addImageAt(src, dropX, dropY);
            };
            reader.readAsDataURL(file);
            return;
        }

        const url = extractImageUrl(e.dataTransfer);
        if (url) {
            addImageAt(url, dropX, dropY);
        }
    };

    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            if (readOnly) return;
            const items = Array.from(e.clipboardData?.items || []);
            const imageItem = items.find(item => item.kind === 'file' && item.type.startsWith('image/'));
            if (imageItem) {
                console.log('Got image from clipboard');
                e.preventDefault();
                const file = imageItem.getAsFile();
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    const src = event.target?.result as string;
                    addImageCentered(src);
                };
                reader.readAsDataURL(file);
                return;
            }

            const text = e.clipboardData?.getData('text/plain')?.trim();
            if (text && isLikelyImageUrl(text)) {
                console.log('Got image URL from clipboard:', text);
                e.preventDefault();
                addImageCentered(text);
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [dimensions.width, dimensions.height, stagePos.x, stagePos.y, stagePos.scale]);

    return (
        <div
            ref={containerRef}
            className="w-full h-full relative object-contain bg-gray-200 overflow-hidden"
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <Stage
                width={dimensions.width}
                height={dimensions.height}
                onWheel={handleWheel}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onMouseDown={readOnly ? undefined : handleMouseDown}
                onMouseMove={readOnly ? undefined : handleMouseMove}
                onMouseUp={readOnly ? undefined : handleMouseUp}
                onDragMove={handleStageDragMove}
                onClick={readOnly ? undefined : handleStageClick}
                scaleX={stagePos.scale}
                scaleY={stagePos.scale}
                x={stagePos.x}
                y={stagePos.y}
                draggable={readOnly || (activeTool === 'select' && !isDropperActive)}
                ref={stageRef}
                style={{ cursor: readOnly ? 'grab' : (isDropperActive ? 'crosshair' : 'default') }}
            >
                <Layer>
                    {/* Canvas Objects */}
                    {objects.map((item) =>
                        editingText && editingText.id === item.id ? null : (
                            <ShapeRenderer
                                onDblClick={() => !readOnly && handleShapeDblClick(item)}
                                key={item.id}
                                item={item}
                                isSelected={selectedIds.includes(item.id)}
                                dragEnabled={!readOnly && activeTool === 'select' && !isDropperActive}
                                onSelect={(e) => {
                                    if (readOnly) return;
                                    const isCtrl = !!e?.evt?.ctrlKey;
                                    if (isCtrl) {
                                        toggleSelectItem(item.id);
                                        return;
                                    }
                                    selectItem(item.id);
                                }}
                                onChange={(updates) => updateItem(item.id, updates)}
                                onGroupDragStart={
                                    activeTool === 'select' && selectedIds.length > 1 && selectedIds.includes(item.id)
                                        ? () => {
                                            if (!groupDragSnapshotRef.current) {
                                                groupDragSnapshotRef.current = objects;
                                            }
                                        }
                                        : undefined
                                }
                                onGroupDragMove={
                                    activeTool === 'select' && selectedIds.length > 1 && selectedIds.includes(item.id)
                                        ? (delta) => moveItemsByDeltaTransient(selectedIds, delta)
                                        : undefined
                                }
                                onGroupDragEnd={
                                    activeTool === 'select' && selectedIds.length > 1 && selectedIds.includes(item.id)
                                        ? () => {
                                            if (groupDragSnapshotRef.current) {
                                                commitHistory(groupDragSnapshotRef.current);
                                                groupDragSnapshotRef.current = null;
                                            }
                                        }
                                        : undefined
                                }
                            />
                        )
                    )}

                    {/* Current Shape Being Drawn */}
                    {currentShapes.map((shape) => (
                        <ShapeRenderer
                            key={shape.id}
                            item={shape}
                            isSelected={false}
                            dragEnabled={false}
                            onSelect={() => { }}
                            onChange={() => { }}
                        />
                    ))}
                </Layer>
            </Stage>

            {/* Text Editor Overlay */}
            {!readOnly && editingText && (
                <TextEditorOverlay
                    editingText={editingText}
                    stageScale={stagePos.scale}
                    fontStyle={toolSettings.fontStyle}
                    fontWeight={toolSettings.fontWeight}
                    onTextChange={(text) => setEditingText({ ...editingText, text })}
                    onComplete={handleTextComplete}
                    onCancel={handleTextCancel}
                    cancelKey={keyboardShortcuts.cancelKey}
                    saveKey={keyboardShortcuts.textSave.key}
                    saveModifier={keyboardShortcuts.textSave.modifier}
                />
            )}

            {isDraggingImage && (
                <div className="absolute inset-0 bg-blue-600/10 border-2 border-dashed border-blue-500 flex items-center justify-center pointer-events-none">
                    <div className="bg-white/90 px-6 py-3 rounded-lg shadow-lg text-blue-700 font-semibold">
                        Drop to insert image
                    </div>
                </div>
            )}
        </div>
    );
};

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layer, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { resolve, flattenResolved } from '../../editor/render/resolve';
import type { ResolvedNode } from '../../editor/render/resolve';
import { matrixToKonvaAttrs } from '../../editor/render/konvaFactory';
import { movePatch, transformEndPatch, preserveAspectFor, dragOriginOf, type DragOrigin } from '../../editor/transformGesture';
import { preservesAspectByDefault } from '../../core/doc/geometry';
import { localMatrix, type Mat2D } from '../../core/doc/derive';
import { resolveGuides } from '../../editor/render/guides';
import { nodesIntersectNonPrintable } from '../../editor/render/regionOverlay';
import {
    hitTestWorld,
    screenToWorld,
    screenToHm,
    snapCandidates,
    type HitTestable,
    type Point,
    type Rect as ViewRect,
    type Viewport,
} from '../../core/viewport';
import { resolveZoom, centeredViewport, zoomAt } from '../../editor/viewportController';
import { createNodeForInsert } from '../../editor/insertActions';
import { selectionAfterClick, nodesInMarquee } from '../../editor/selectionModel';
import { DEFAULT_CONTENT_SIZE } from '../../core/doc/geometry';
import { GRID_STEP_HM } from './gridConstants';
import { ResolvedShape } from './ResolvedShape';
import { Overlays, type SnapGuideLine } from './Overlays';
import { Rulers } from './Rulers';

/**
 * Preview edit surface (ui-spec.md §5). Bound to the bounded viewport engine in
 * `core/viewport`: fit/real/manual zoom, clamped pan, view-only rotation and
 * engine hit-testing. Renders `resolve(doc)` through `ResolvedShape` (which
 * reuses the shared factory's transform decomposition).
 *
 * Pointer interaction is browser-only (memory/testing.md): drag/marquee/zoom are
 * exercised by the headed check, while the math they call lives in unit-tested
 * pure modules (`viewportController`, `selectionModel`, `core/viewport`).
 */

const SNAP_THRESHOLD_PX = 6;
const RULER_GUTTER = 24;
const ZOOM_MIN = 0.005;
const ZOOM_MAX = 4;

interface MarqueeState {
    start: Point;
    current: Point;
}

interface DragState {
    startWorld: Point;
    /** Full origin transform per node so a move preserves rot/scale (must-fix #4). */
    origins: Map<string, DragOrigin>;
}

const matrixForViewport = (viewport: Viewport): Mat2D => {
    if (viewport.rotation === 90) {
        return { a: 0, b: viewport.zoom, c: -viewport.zoom, d: 0, e: viewport.x, f: viewport.y };
    }
    return { a: viewport.zoom, b: 0, c: 0, d: viewport.zoom, e: viewport.x, f: viewport.y };
};

export const PreviewStage: React.FC = () => {
    const { t } = useTranslation();
    const doc = useStore((state) => state.currentDoc);
    const selectedNodeIds = useStore((state) => state.selectedNodeIds);
    const selectNode = useStore((state) => state.selectNode);
    const selectNodes = useStore((state) => state.selectNodes);
    const clearNodeSelection = useStore((state) => state.clearNodeSelection);
    const activeTool = useStore((state) => state.activeTool);
    const clearActiveTool = useStore((state) => state.clearActiveTool);
    const addNode = useStore((state) => state.addNode);
    const updateNodeTransient = useStore((state) => state.updateNodeTransient);
    const commitDoc = useStore((state) => state.commitDoc);
    const resetTransient = useStore((state) => state.resetTransient);

    const gridVisible = useStore((state) => state.gridVisible);
    const snapEnabled = useStore((state) => state.snapEnabled);
    const rulersVisible = useStore((state) => state.rulersVisible);
    const viewRotation = useStore((state) => state.viewRotation);
    const zoomMode = useStore((state) => state.zoomMode);
    const manualZoom = useStore((state) => state.manualZoom);
    const setEffectiveZoom = useStore((state) => state.setEffectiveZoom);
    const screenDpi = useStore((state) => state.screenDpi);

    const containerRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<Konva.Stage>(null);
    const layerRef = useRef<Konva.Layer>(null);
    const transformerRef = useRef<Konva.Transformer>(null);
    const nodeRefs = useRef(new Map<string, Konva.Node>());
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1, rotation: 0 });
    const [marquee, setMarquee] = useState<MarqueeState | null>(null);
    const [snapLines, setSnapLines] = useState<SnapGuideLine[]>([]);
    const dragRef = useRef<DragState | null>(null);
    const panRef = useRef<{ startScreen: Point; startPan: Point } | null>(null);
    /** Last shift/alt state; `transformend` has no event modifiers of its own. */
    const modifierRef = useRef(false);
    /** A Transformer gesture is live (armed at transformstart, cleared at end). */
    const transformingRef = useRef(false);

    const backing = useMemo(
        () => (doc ? { backingW: doc.label.backingW, backingH: doc.label.backingH } : null),
        [doc],
    );

    // Measure the available preview area.
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const innerSize = useMemo(
        () => ({
            w: Math.max(1, size.w - (rulersVisible ? RULER_GUTTER : 0)),
            h: Math.max(1, size.h - (rulersVisible ? RULER_GUTTER : 0)),
        }),
        [size, rulersVisible],
    );

    const zoom = useMemo(() => {
        if (!backing || innerSize.w <= 1 || innerSize.h <= 1) return 1;
        return resolveZoom(zoomMode, manualZoom, backing, innerSize, viewRotation, screenDpi);
    }, [backing, innerSize, zoomMode, manualZoom, viewRotation, screenDpi]);

    // Recenter whenever the derived zoom, rotation, backing or area changes.
    useEffect(() => {
        if (!backing || innerSize.w <= 1) return;
        setViewport(centeredViewport(zoom, backing, innerSize, viewRotation));
    }, [zoom, viewRotation, backing, innerSize]);

    useEffect(() => {
        if (viewport.zoom > 0) setEffectiveZoom(viewport.zoom);
    }, [viewport.zoom, setEffectiveZoom]);

    const resolved = useMemo<ResolvedNode[]>(() => (doc ? resolve(doc) : []), [doc]);
    const flatResolved = useMemo(() => flattenResolved(resolved), [resolved]);
    const targets = useMemo<HitTestable[]>(
        () => flatResolved.map((node) => ({ id: node.id, bounds: node.bounds, visible: node.visible, locked: node.locked })),
        [flatResolved],
    );
    const guides = useMemo(() => (doc ? resolveGuides(doc) : []), [doc]);
    const keepOutIds = useMemo(() => (doc ? nodesIntersectNonPrintable(doc) : []), [doc]);
    const keepOutBounds = useMemo(() => {
        const map = new Map<string, ViewRect>();
        for (const node of flatResolved) map.set(node.id, node.bounds);
        return map;
    }, [flatResolved]);

    // Reset stale refs on each document change.
    useEffect(() => {
        nodeRefs.current.clear();
    }, [doc]);

    // Attach the Transformer to the selected nodes with live refs.
    useEffect(() => {
        const transformer = transformerRef.current;
        if (!transformer) return;
        const nodes = selectedNodeIds
            .map((id) => nodeRefs.current.get(id))
            .filter((node): node is Konva.Node => Boolean(node));
        transformer.nodes(nodes);
        transformer.getLayer()?.batchDraw();
    }, [selectedNodeIds, resolved]);

    // Live Transformer ratio matches the aspect rule applied at commit (§13):
    // uniform for a single ellipse/image/QR, free otherwise (mixed selections
    // cannot carry one locked ratio). Shift/Alt inverts it at commit time.
    const selectedNodesPreserveAspect = useMemo(() => {
        if (selectedNodeIds.length !== 1 || !doc) return false;
        const node = doc.nodes.find((n) => n.id === selectedNodeIds[0]);
        return node ? preservesAspectByDefault(node) : false;
    }, [selectedNodeIds, doc]);

    const registerRef = useCallback((id: string, node: Konva.Node | null) => {
        if (node) nodeRefs.current.set(id, node);
        else nodeRefs.current.delete(id);
    }, []);

    const pointerWorld = useCallback(
        (stage: Konva.Stage): Point | null => {
            const pointer = stage.getPointerPosition();
            if (!pointer) return null;
            return screenToWorld(pointer, viewport);
        },
        [viewport],
    );

    const beginDrag = useCallback(
        (world: Point, ids: readonly string[]) => {
            const origins = new Map<string, DragOrigin>();
            if (!doc) return;
            for (const id of ids) {
                const node = doc.nodes.find((entry) => entry.id === id);
                if (node) origins.set(id, dragOriginOf(node));
            }
            dragRef.current = { startWorld: world, origins };
        },
        [doc],
    );

    const handlePointerDown = useCallback(
        (event: Konva.KonvaEventObject<PointerEvent>) => {
            const stage = stageRef.current;
            if (!stage || !doc) return;
            const world = pointerWorld(stage);
            if (!world) return;

            // Middle button (or an armed pan) starts panning.
            if (event.evt.button === 1) {
                const pointer = stage.getPointerPosition();
                if (pointer) panRef.current = { startScreen: pointer, startPan: { x: viewport.x, y: viewport.y } };
                event.evt.preventDefault();
                return;
            }
            if (event.evt.button !== 0) return;

            // Armed insert action: place, select, disarm.
            if (activeTool !== 'select') {
                const point = screenToHm(stage.getPointerPosition()!, viewport);
                const node = createNodeForInsert(activeTool, point.x, point.y);
                if (node) {
                    const id = addNode(node);
                    if (id) selectNode(id);
                }
                clearActiveTool();
                return;
            }

            const additive = event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey;
            const hitId = hitTestWorld(world, targets);
            const nextSelection = selectionAfterClick(selectedNodeIds, hitId, additive);

            if (hitId !== null) {
                if (!additive && !selectedNodeIds.includes(hitId)) selectNode(hitId);
                else selectNodes(nextSelection);
                // A plain click on an already-selected node begins a move.
                if (!additive) beginDrag(world, selectedNodeIds.includes(hitId) ? selectedNodeIds : [hitId]);
                return;
            }

            // Empty canvas: clear (unless additive) and start a marquee.
            if (!additive) clearNodeSelection();
            const pointer = stage.getPointerPosition();
            if (pointer) setMarquee({ start: pointer, current: pointer });
        },
        [doc, pointerWorld, viewport, activeTool, addNode, selectNode, clearActiveTool, selectedNodeIds, selectNodes, clearNodeSelection, beginDrag, targets],
    );

    const handlePointerMove = useCallback(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const pan = panRef.current;
        if (pan) {
            setViewport((current) => ({
                ...current,
                x: pan.startPan.x + (pointer.x - pan.startScreen.x),
                y: pan.startPan.y + (pointer.y - pan.startScreen.y),
            }));
            return;
        }

        if (marquee) {
            setMarquee({ ...marquee, current: pointer });
            return;
        }

        const drag = dragRef.current;
        if (drag && doc) {
            const world = screenToWorld(pointer, viewport);
            let dx = world.x - drag.startWorld.x;
            let dy = world.y - drag.startWorld.y;

            if (snapEnabled) {
                const movingNodes = drag.origins.size;
                const primary = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
                const movingBox: ViewRect = {
                    x: primary ? (drag.origins.get(primary)?.x ?? 0) + dx : dx,
                    y: primary ? (drag.origins.get(primary)?.y ?? 0) + dy : dy,
                    w: DEFAULT_CONTENT_SIZE,
                    h: DEFAULT_CONTENT_SIZE,
                };
                const candidates = snapCandidates(movingBox, {
                    backing: backing!,
                    regions: doc.label.regions,
                    grid: GRID_STEP_HM,
                });
                const thresholdHm = SNAP_THRESHOLD_PX / viewport.zoom;
                let bestX: (typeof candidates)[number] | null = null;
                let bestY: (typeof candidates)[number] | null = null;
                for (const candidate of candidates) {
                    if (Math.abs(candidate.delta) > thresholdHm) continue;
                    if (candidate.axis === 'x' && (!bestX || Math.abs(candidate.delta) < Math.abs(bestX.delta))) bestX = candidate;
                    if (candidate.axis === 'y' && (!bestY || Math.abs(candidate.delta) < Math.abs(bestY.delta))) bestY = candidate;
                }
                const lines: SnapGuideLine[] = [];
                if (bestX) {
                    dx += bestX.delta;
                    lines.push({ axis: 'x', guide: bestX.guide, extent: doc.label.backingH });
                }
                if (bestY) {
                    dy += bestY.delta;
                    lines.push({ axis: 'y', guide: bestY.guide, extent: doc.label.backingW });
                }
                void movingNodes;
                setSnapLines(lines);
            }

            for (const [id, origin] of drag.origins) {
                updateNodeTransient(id, movePatch(origin, dx, dy));
            }
        }
    }, [doc, marquee, viewport, snapEnabled, selectedNodeIds, backing, updateNodeTransient]);

    /**
     * Finalize any armed pointer gesture: release pan, drop snap guides and
     * commit an in-progress move. Idempotent — `commitDoc` no-ops on a null
     * baseline — so the stage handler and the window finalizer can both call it.
     * Deliberately does **not** run marquee math or touch selection (must-fix
     * #5): a release over the MFP/rail must not clear a fresh selection.
     */
    const finalizeGesture = useCallback(() => {
        const hadGesture = panRef.current !== null || dragRef.current !== null || transformingRef.current;
        const abortedTransform = transformingRef.current;
        panRef.current = null;
        dragRef.current = null;
        transformingRef.current = false;
        // Identity-preserving updates: this runs on every app-wide pointerup,
        // so avoid re-rendering when nothing changed.
        setSnapLines((lines) => (lines.length === 0 ? lines : []));
        // A marquee abandoned off-stage has no fresh pointer position to apply,
        // so drop it rather than selecting from a stale rect. (This is cleanup,
        // not selection logic — it never calls `clearNodeSelection`.)
        setMarquee((current) => (current === null ? current : null));
        if (hadGesture) {
            // Re-sync the Transformer so a release outside the stage cannot leave
            // a half-applied handle gesture on screen.
            transformerRef.current?.forceUpdate();
            layerRef.current?.batchDraw();
        }
        // A transform released outside the stage never fires `transformend`, so
        // its live Konva scale/rotation is reset from the (unchanged) document.
        if (abortedTransform && doc) {
            for (const id of selectedNodeIds) {
                const konvaNode = nodeRefs.current.get(id);
                const source = doc.nodes.find((entry) => entry.id === id);
                if (konvaNode && source) konvaNode.setAttrs(matrixToKonvaAttrs(localMatrix(source.transform)));
            }
        }
        // Idempotent: no-ops when no transient baseline is open. Ends a move
        // gesture (dragRef) exactly once, even if released over the MFP/rail.
        commitDoc();
    }, [commitDoc, doc, selectedNodeIds]);

    // Window-level finalizer so a pointer released outside the stage content
    // (over the MFP/rail) still ends the gesture. Matched add/remove keeps
    // StrictMode's double-invoke from double-registering.
    useEffect(() => {
        window.addEventListener('pointerup', finalizeGesture);
        window.addEventListener('pointercancel', finalizeGesture);
        return () => {
            window.removeEventListener('pointerup', finalizeGesture);
            window.removeEventListener('pointercancel', finalizeGesture);
        };
    }, [finalizeGesture]);

    const handlePointerUp = useCallback(() => {
        if (marquee) {
            if (doc) {
                const minX = Math.min(marquee.start.x, marquee.current.x);
                const minY = Math.min(marquee.start.y, marquee.current.y);
                const maxX = Math.max(marquee.start.x, marquee.current.x);
                const maxY = Math.max(marquee.start.y, marquee.current.y);
                const topLeft = screenToWorld({ x: minX, y: minY }, viewport);
                const bottomRight = screenToWorld({ x: maxX, y: maxY }, viewport);
                const rect: ViewRect = {
                    x: Math.min(topLeft.x, bottomRight.x),
                    y: Math.min(topLeft.y, bottomRight.y),
                    w: Math.abs(bottomRight.x - topLeft.x),
                    h: Math.abs(bottomRight.y - topLeft.y),
                };
                if (rect.w > 0 && rect.h > 0) selectNodes(nodesInMarquee(doc, rect));
            }
            setMarquee(null);
        }
        finalizeGesture();
    }, [marquee, doc, viewport, selectNodes, finalizeGesture]);

    const handleWheel = useCallback(
        (event: Konva.KonvaEventObject<WheelEvent>) => {
            if (!backing) return;
            event.evt.preventDefault();
            const stage = stageRef.current;
            if (!stage) return;
            const pointer = stage.getPointerPosition() ?? { x: innerSize.w / 2, y: innerSize.h / 2 };
            const factor = event.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
            const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewport.zoom * factor));
            setViewport(zoomAt(viewport, pointer, next, backing, innerSize));
        },
        [backing, innerSize, viewport],
    );

    // Esc cancels an armed action and clears selection.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (document.querySelector('dialog[open]')) return;
            clearActiveTool();
            clearNodeSelection();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [clearActiveTool, clearNodeSelection]);

    /**
     * Batch a Transformer gesture into **one** undo entry (must-fix #3): apply
     * every selected node's resize + rotation transiently, then a single
     * `commitDoc`. `preserveAspect` follows the plan default per node type and
     * is inverted by a shift/alt press so the UI can opt out (ellipse/image/QR
     * preserve; rect/line/polygon/text are free).
     */
    const handleTransformEnd = useCallback(
        () => {
            transformingRef.current = false;
            if (!doc) return;
            // `transformend` carries no reliable modifier state, so the last
            // shift/alt press is tracked on a ref (see the key effect below).
            const inverted = modifierRef.current;
            for (const id of selectedNodeIds) {
                const konvaNode = nodeRefs.current.get(id);
                const source = doc.nodes.find((entry) => entry.id === id);
                if (!konvaNode || !source) continue;
                const width = Math.abs(konvaNode.width() * konvaNode.scaleX()) || DEFAULT_CONTENT_SIZE;
                const height = Math.abs(konvaNode.height() * konvaNode.scaleY()) || DEFAULT_CONTENT_SIZE;
                updateNodeTransient(
                    id,
                    transformEndPatch(
                        source,
                        { w: Math.round(width), h: Math.round(height) },
                        preserveAspectFor(source, inverted),
                        konvaNode.rotation(),
                    ),
                );
            }
            commitDoc();
        },
        [doc, selectedNodeIds, updateNodeTransient, commitDoc],
    );

    // Abandon a half-open transient gesture if the preview unmounts mid-gesture
    // (view switch, doc close). The cleanup must not commit.
    useEffect(() => () => resetTransient(), [resetTransient]);

    // Track shift/alt so a transform gesture can opt in/out of aspect lock.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            modifierRef.current = event.shiftKey || event.altKey;
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('keyup', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('keyup', onKey);
        };
    }, []);

    if (!doc || !backing) {
        return (
            <div className="flex flex-1 items-center justify-center bg-gray-200 text-sm text-gray-500">
                {t('editor.loading')}
            </div>
        );
    }

    const viewportMatrix = matrixForViewport(viewport);
    const sceneAttrs = matrixForViewportAttrs(viewportMatrix);
    const marqueeRect =
        marquee &&
        ({
            x: Math.min(marquee.start.x, marquee.current.x) + (rulersVisible ? RULER_GUTTER : 0),
            y: Math.min(marquee.start.y, marquee.current.y) + (rulersVisible ? RULER_GUTTER : 0),
            w: Math.abs(marquee.current.x - marquee.start.x),
            h: Math.abs(marquee.current.y - marquee.start.y),
        } as ViewRect);

    return (
        <div
            ref={containerRef}
            className={cn('relative flex-1 overflow-hidden bg-gray-200', activeTool !== 'select' && 'cursor-crosshair')}
            style={rulersVisible ? { paddingLeft: RULER_GUTTER, paddingTop: RULER_GUTTER } : undefined}
        >
            <Stage
                ref={stageRef}
                width={innerSize.w}
                height={innerSize.h}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onWheel={handleWheel}
            >
                <Layer ref={layerRef} {...sceneAttrs}>
                    {resolved.map((node) => (
                        <ResolvedShape
                            key={node.id}
                            node={node}
                            registerRef={registerRef}
                            selected={selectedNodeIds.includes(node.id)}
                            warn={keepOutIds.includes(node.id)}
                        />
                    ))}
                    <Transformer
                        ref={transformerRef}
                        rotateEnabled
                        keepRatio={selectedNodesPreserveAspect}
                        onTransformStart={() => {
                            transformingRef.current = true;
                        }}
                        onTransformEnd={handleTransformEnd}
                        borderStroke="#3b82f6"
                        anchorStroke="#3b82f6"
                        anchorSize={8}
                    />
                </Layer>
                <Overlays
                    doc={doc}
                    guides={guides}
                    showGrid={gridVisible}
                    gridStepHm={GRID_STEP_HM}
                    snapLines={snapLines}
                    keepOutIds={keepOutIds}
                    keepOutBounds={keepOutBounds}
                    layerAttrs={sceneAttrs}
                />
            </Stage>

            {rulersVisible && <Rulers viewport={viewport} backingW={backing.backingW} backingH={backing.backingH} />}

            {marqueeRect && (
                <div
                    className="pointer-events-none absolute border border-blue-500 bg-blue-500/10"
                    style={{ left: marqueeRect.x, top: marqueeRect.y, width: marqueeRect.w, height: marqueeRect.h }}
                />
            )}
        </div>
    );
};

/** Viewport transform attrs for a Konva layer, via the shared factory. */
const matrixForViewportAttrs = (matrix: Mat2D) => matrixToKonvaAttrs(matrix);

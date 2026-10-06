import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layer, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { flattenResolved, resolve } from '../../editor/render/resolve';
import type { ResolvedContent, ResolvedNode } from '../../editor/render/resolve';
import type { GlobalWarning } from '../../templates/globals';
import type { LabelDoc, Node } from '../../core/doc/types';
import { matrixToKonvaAttrs } from '../../editor/render/konvaFactory';
import { movePatch, transformEndPatch, commitPreservesAspect, transformerTargetSize, dragOriginOf, type DragOrigin } from '../../editor/transformGesture';
import { nodeSize, pointsExtent, preservesAspectByDefault, DEFAULT_CONTENT_SIZE, type Size } from '../../core/doc/geometry';
import { type Mat2D } from '../../core/doc/derive';
import { resolveGuides } from '../../editor/render/guides';
import { nodesIntersectNonPrintable } from '../../editor/render/regionOverlay';
import {
    clampPan,
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
import { GRID_STEP_HM } from './gridConstants';
import { ResolvedShape } from './ResolvedShape';
import { usePreparedAssets } from './usePreparedAssets';
import { useSampleRowState } from './sampleRowContext';
import { Overlays, type SnapGuideLine } from './Overlays';
import { Rulers } from './Rulers';

/**
 * Preview edit surface (ui-spec.md §5). Bound to the bounded viewport engine in
 * `core/viewport`: fit/real/manual zoom, clamped pan, view-only rotation and
 * engine hit-testing. Renders the sample-row resolved tree (P6 `useSampleRow`)
 * through `ResolvedShape` (which reuses the shared factory's transform
 * decomposition).
 *
 * Pointer interaction is browser-only (memory/testing.md): drag/marquee/zoom are
 * exercised by the headed check, while the math they call lives in unit-tested
 * pure modules (`viewportController`, `selectionModel`, `core/viewport`).
 */

const SNAP_THRESHOLD_PX = 6;
const RULER_GUTTER = 24;
const ZOOM_MIN = 0.005;
const ZOOM_MAX = 4;

/** Stable identities for an isolated mount with no sample-row provider. */
const EMPTY_RESOLVED: ResolvedNode[] = [];
const EMPTY_WARNINGS: GlobalWarning[] = [];

/**
 * Resolve the preview's synchronous scene graph from the live `doc` and the
 * async sample-row override map (W6). The override map supplies evaluated
 * csv/template content keyed by node id; everything else (geometry, visibility,
 * groups) is resolved fresh on every call, so a drag/resize repaints immediately
 * without waiting for the data pre-pass. Extracted so this wiring is unit-tested
 * without mounting Konva; a missing doc yields the shared empty tree.
 */
export const resolvePreviewTree = (
    doc: LabelDoc | null,
    overrides: ReadonlyMap<string, ResolvedContent> | undefined,
): ResolvedNode[] => (doc ? resolve(doc, overrides ? { overrides } : {}) : EMPTY_RESOLVED);

interface MarqueeState {
    start: Point;
    current: Point;
}

interface DragState {
    startWorld: Point;
    /** Full origin transform per node so a move preserves rot/scale (must-fix #4). */
    origins: Map<string, DragOrigin>;
    /** World bounds per dragged node captured at drag start, for snapping. */
    bounds: Map<string, ViewRect>;
}

const matrixForViewport = (viewport: Viewport): Mat2D => {
    if (viewport.rotation === 90) {
        return { a: 0, b: viewport.zoom, c: -viewport.zoom, d: 0, e: viewport.x, f: viewport.y };
    }
    return { a: viewport.zoom, b: 0, c: 0, d: viewport.zoom, e: viewport.x, f: viewport.y };
};

/**
 * A node's real local extent before a Transformer gesture (must-fix #2): the
 * `size` box for boxed content, and the point cloud's bounding box for
 * line/polygon. `Konva.Line.width()` is `undefined`, so using it directly left
 * point shapes resizing against a fixed default box.
 */
const nodeBaseExtent = (node: Node): Size =>
    node.type === 'shape' && (node.shape === 'line' || node.shape === 'polygon')
        ? pointsExtent(node.points ?? [])
        : nodeSize(node);

/**
 * True when a pointer event's target belongs to the Transformer (an anchor,
 * rotater or border), which runs its own resize/rotate gesture. Konva's anchor
 * mousedown does not `cancelBubble` (Transformer.js), so the Stage handler also
 * sees it; without this guard the anchor centre lands inside the node AABB and
 * the move/marquee logic hijacks the resize (task 12). Exported so the guard is
 * unit-tested without mounting Konva.
 */
export function isTransformerTarget(target: Konva.Node | null | undefined): boolean {
    return !!target?.findAncestor?.('Transformer', true);
}

/**
 * The selected node ids the Transformer may attach to, with groups filtered
 * out. `resizeNodeGeometry` is a no-op for a group (D-10), so attaching one
 * would only translate/rotate it and open a dead undo entry on release; the
 * filter keeps that impossible even if a group id ever reaches the selection.
 * (The preview hit-test can select a group — its resolved bounds are the
 * children's union — so this is a live guard, not dead code.) Exported so the
 * exclusion is unit-tested without mounting Konva.
 */
export function transformerTargetIds(
    selectedIds: readonly string[],
    nodes: readonly Node[],
): string[] {
    const groupIds = new Set(nodes.filter((node) => node.type === 'group').map((node) => node.id));
    return selectedIds.filter((id) => !groupIds.has(id));
}

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
    const flushAutosave = useStore((state) => state.flushAutosave);

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
    /** Latest resolved world bounds, read by drag start without re-binding. */
    const nodeBoundsRef = useRef<Map<string, ViewRect>>(new Map());
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
    /**
     * The anchor the live Transformer gesture started on. Konva tears its own
     * active anchor (`_movingAnchorName`) down while ending the gesture, so
     * capture it at `transformstart` rather than rely on that teardown ordering
     * — the commit needs it to know corner (aspect) vs side (free-stretch) (#13).
     */
    const activeAnchorRef = useRef<string | null>(null);

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

    // The sample-row resolve pipeline (P6 W6): CSV binding, trust gating,
    // globals prefetch and template execution for `doc.data.sampleRowIndex`.
    // Shared with the MFP via context; an isolated mount (no provider) renders
    // an empty tree rather than running a second pass.
    //
    // W6 fix: the async pass supplies only the **override map** (evaluated
    // csv/template content). The scene graph is resolved **synchronously on
    // every render** from the live `doc`, so drag/resize/hide/lock/group repaint
    // immediately instead of waiting for a pass keyed on data-only inputs.
    const sampleRow = useSampleRowState();
    const overrides = sampleRow?.overrides;
    const resolved = useMemo(() => resolvePreviewTree(doc, overrides), [doc, overrides]);
    const blocked = sampleRow?.blocked ?? false;
    const needsApproval = sampleRow?.needsApproval ?? false;
    const templateErrors = sampleRow?.templateErrors;
    const sampleRowError = sampleRow?.error ?? null;
    const globalWarnings = sampleRow?.globalWarnings ?? EMPTY_WARNINGS;
    const flatResolved = useMemo(() => flattenResolved(resolved), [resolved]);
    // Decoded image / qr / barcode rasters for the preview (P5). The resolution
    // cap follows the on-screen device scale, so previews never over-decode.
    const { assets, warnings } = usePreparedAssets(resolved, doc);
    /** Placeholder label per asset leaf: the image's resource name, or the node id. */
    const assetLabels = useMemo(() => {
        const map = new Map<string, string>();
        if (!doc) return map;
        const imageNames = new Map(doc.resources.images.map((ref) => [ref.imageId, ref.name] as const));
        for (const node of flatResolved) {
            if (node.type === 'image') map.set(node.id, imageNames.get(node.imageId) ?? (node.imageId || node.id));
            else if (node.type === 'qr' || node.type === 'barcode') map.set(node.id, node.id);
        }
        return map;
    }, [doc, flatResolved]);
    const targets = useMemo<HitTestable[]>(
        () => flatResolved.map((node) => ({ id: node.id, bounds: node.bounds, visible: node.visible, locked: node.locked })),
        [flatResolved],
    );
    const guides = useMemo(() => (doc ? resolveGuides(doc) : []), [doc]);
    const keepOutIds = useMemo(() => (doc ? nodesIntersectNonPrintable(doc) : []), [doc]);
    /** World bounds per resolved node — used for keep-out badges and drag snap. */
    const nodeBoundsById = useMemo(() => {
        const map = new Map<string, ViewRect>();
        for (const node of flatResolved) map.set(node.id, node.bounds);
        return map;
    }, [flatResolved]);
    const keepOutBounds = nodeBoundsById;
    // Keep the latest bounds reachable from `beginDrag` without a stale closure.
    nodeBoundsRef.current = nodeBoundsById;

    // Attach the Transformer to the selected nodes with live refs. Stale refs
    // need no manual clearing: the `registerRef` callback refs delete an entry
    // when their shape unmounts and re-register it on (re)mount, so wiping the
    // map here would only race React's re-attach and detach the anchors.

    useEffect(() => {
        const transformer = transformerRef.current;
        if (!transformer) return;
        // Attach only the resizable leaves: `transformerTargetIds` drops groups,
        // for which `resizeNodeGeometry` is a no-op (D-10).
        const nodes = transformerTargetIds(selectedNodeIds, doc?.nodes ?? [])
            .map((id) => nodeRefs.current.get(id))
            .filter((node): node is Konva.Node => Boolean(node));
        transformer.nodes(nodes);
        transformer.getLayer()?.batchDraw();
    }, [selectedNodeIds, resolved, doc]);

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
            const bounds = new Map<string, ViewRect>();
            if (!doc) return;
            for (const id of ids) {
                const node = doc.nodes.find((entry) => entry.id === id);
                if (node) origins.set(id, dragOriginOf(node));
                const box = nodeBoundsRef.current.get(id);
                if (box) bounds.set(id, box);
            }
            dragRef.current = { startWorld: world, origins, bounds };
        },
        [doc],
    );

    const handlePointerDown = useCallback(
        (event: Konva.KonvaEventObject<PointerEvent>) => {
            const stage = stageRef.current;
            if (!stage || !doc) return;

            // A Transformer anchor/rotater/border handles its own gesture. Konva's
            // anchor mousedown does not cancelBubble (Transformer.js), so the
            // Stage handler also sees it; without this early return the anchor
            // centre lands inside the node AABB and the move/marquee logic below
            // hijacks the resize (task 12).
            if (isTransformerTarget(event.target)) return;

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
                // A plain click begins a move of exactly the selection the user
                // now sees (must-fix #11); using the pre-click list moved nodes
                // that a collapsing click had just deselected.
                if (!additive) beginDrag(world, nextSelection);
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
            // Clamp pan so the label can never leave the viewport (plan §3).
            if (backing) {
                setViewport((current) =>
                    clampPan(
                        {
                            ...current,
                            x: pan.startPan.x + (pointer.x - pan.startScreen.x),
                            y: pan.startPan.y + (pointer.y - pan.startScreen.y),
                        },
                        backing,
                        innerSize,
                    ),
                );
            }
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
                const movingIds = new Set(drag.origins.keys());
                const primary = selectedNodeIds.length === 1 ? selectedNodeIds[0] : [...movingIds][0];
                // Use the bounds captured at drag start: the resolved bounds
                // recompute from the already-moved transient doc each render, so
                // reading them live would double-count the drag delta.
                const primaryBounds = primary ? drag.bounds.get(primary) : undefined;
                const origin = primary ? drag.origins.get(primary) : undefined;
                // The dragged node's real world bounds, shifted by the drag
                // (must-fix #7); fall back to its transform origin only when no
                // resolved bounds exist.
                const movingBox: ViewRect = primaryBounds
                    ? { x: primaryBounds.x + dx, y: primaryBounds.y + dy, w: primaryBounds.w, h: primaryBounds.h }
                    : {
                          x: (origin?.x ?? 0) + dx,
                          y: (origin?.y ?? 0) + dy,
                          w: DEFAULT_CONTENT_SIZE,
                          h: DEFAULT_CONTENT_SIZE,
                      };
                // Sibling edges must be snapped to as well (must-fix #7), so
                // pass every other resolved node's world bounds.
                const siblings: ViewRect[] = [];
                for (const [id, bounds] of nodeBoundsById) {
                    if (!movingIds.has(id)) siblings.push(bounds);
                }
                const candidates = snapCandidates(movingBox, {
                    backing: backing!,
                    regions: doc.label.regions,
                    siblings,
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
                setSnapLines(lines);
            }

            for (const [id, origin] of drag.origins) {
                updateNodeTransient(id, movePatch(origin, dx, dy));
            }
        }
    }, [doc, marquee, viewport, snapEnabled, selectedNodeIds, backing, innerSize, nodeBoundsById, updateNodeTransient]);

    /**
     * Finalize any armed pointer gesture: release pan, drop snap guides and
     * commit an in-progress move. Idempotent — `commitDoc` no-ops on a null
     * baseline — so the stage handler and the window finalizer can both call it.
     * Deliberately does **not** run marquee math or touch selection (must-fix
     * #5): a release over the MFP/rail must not clear a fresh selection.
     *
     * A live Transformer gesture is deliberately left alone: Konva fires
     * `transformend` from window `mouseup` **after** this `pointerup` finalizer,
     * so `handleTransformEnd` owns the commit. Resetting the node's attrs here
     * (or committing) would clobber the live geometry before that handler can
     * read it — the transform no-op (must-fix #1).
     */
    const finalizeGesture = useCallback(() => {
        const hadGesture = panRef.current !== null || dragRef.current !== null || transformingRef.current;
        const wasTransforming = transformingRef.current;
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
            // a half-applied handle gesture on screen. Skipped for a live
            // transform: `transformend` still has to read the live geometry.
            if (!wasTransforming) {
                transformerRef.current?.forceUpdate();
                layerRef.current?.batchDraw();
            }
        }
        // Idempotent: no-ops when no transient baseline is open. Ends a move
        // gesture (dragRef) exactly once, even if released over the MFP/rail.
        // A live transform has no transient baseline yet (the patch is applied
        // in `handleTransformEnd`), so this is a no-op for it.
        commitDoc();
    }, [commitDoc]);

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
     * `commitDoc`. The patch is derived from the **live Konva node** geometry —
     * its actual scale/rotation after the gesture — not from the untouched doc
     * (must-fix #1): Konva fires `transformend` after the window `pointerup`
     * finalizer, so the doc is still the pre-gesture baseline here.
     *
     * The resize base is the node's real local extent (must-fix #2): `size` for
     * boxed content, `points` bbox for line/polygon (`Konva.Line.width()` is
     * `undefined`).
     *
     * Anchor policy (#13): Konva applies `keepRatio` **only** to the four corner
     * anchors, so a corner gesture is uniform live while a side-anchor gesture
     * free-stretches. The commit mirrors that exactly — corner keeps the ratio,
     * side stays free — and passes the live uniform factor so the release can
     * never snap to `Math.max(rawX, rawY)`. `commitPreservesAspect` resolves the
     * corner case from the observed live scales, so an aspect node's corner stays
     * uniform even when a modifier is held.
     */
    const handleTransformEnd = useCallback(
        () => {
            transformingRef.current = false;
            if (!doc) return;
            // `transformend` carries no reliable modifier state, so the last
            // shift/alt press is tracked on a ref (see the key effect below).
            const inverted = modifierRef.current;
            // Konva tears its active anchor (`_movingAnchorName`) down as part of
            // ending the gesture, so read it from the value captured at
            // `transformstart` rather than depend on the teardown ordering.
            const anchor = activeAnchorRef.current;
            for (const id of selectedNodeIds) {
                const konvaNode = nodeRefs.current.get(id);
                const source = doc.nodes.find((entry) => entry.id === id);
                // Groups are not attached to the Transformer (D-10); skip them.
                if (!konvaNode || !source || source.type === 'group') continue;
                // Read geometry from the live node: the Transformer mutates the
                // Konva node's scale/rotation in place during a gesture, while
                // the document stays at the pre-gesture baseline.
                const base = nodeBaseExtent(source);
                const target = transformerTargetSize(base, konvaNode.scaleX(), konvaNode.scaleY());
                // The live gesture's actual uniform/free choice, read straight
                // off the scales: `|scaleX| == |scaleY|` exactly when Konva held
                // the ratio (a corner with `keepRatio` on or Shift). This is what
                // `commitPreservesAspect` trusts, so Alt (centred scaling without
                // forcing the ratio) can never lock a gesture that ran free.
                //
                // Keep the **signed** scales for the commit and the magnitudes
                // for the aspect/uniform checks: dragging a handle past the
                // opposite edge mirrors the node (Konva `flipEnabled` defaults
                // true), and the sign must reach `transformEndPatch` or the
                // mirror reverts on release.
                const liveScaleX = konvaNode.scaleX();
                const liveScaleY = konvaNode.scaleY();
                const scaleX = Math.abs(liveScaleX);
                const scaleY = Math.abs(liveScaleY);
                const liveUniform = Math.abs(scaleX - scaleY) <= 1e-6 * Math.max(1, scaleX, scaleY);
                // Mirror the live ratio decision exactly — see
                // `commitPreservesAspect`: an aspect-default node's corner always
                // ran uniform (`keepRatio` on), so `liveUniform` is authoritative
                // there; a non-aspect corner locked only when a modifier forced
                // it, guarded by `liveUniform` to separate Shift from Alt.
                const preserveAspect = commitPreservesAspect(
                    source,
                    anchor,
                    inverted,
                    selectedNodesPreserveAspect,
                    liveUniform,
                );
                updateNodeTransient(
                    id,
                    transformEndPatch(
                        source,
                        { w: Math.round(target.w), h: Math.round(target.h) },
                        preserveAspect,
                        {
                            x: konvaNode.x(),
                            y: konvaNode.y(),
                            rotDeg: konvaNode.rotation(),
                            // Signed: a flipped gesture must stay flipped.
                            scaleX: liveScaleX,
                            scaleY: liveScaleY,
                        },
                        // Hand the exact live uniform factor (magnitude) to the
                        // resize so rounding the target box cannot bias the
                        // commit.
                        preserveAspect ? scaleX : undefined,
                    ),
                );
            }
            commitDoc();
        },
        [doc, selectedNodeIds, selectedNodesPreserveAspect, updateNodeTransient, commitDoc],
    );

    // A page reload/close inside the autosave debounce would otherwise drop the
    // last edit; commit any open transient gesture, then flush the pending
    // write on `pagehide` (must-fix #8). Ordering matters: `commitDoc` schedules
    // the autosave, `flushAutosave` then writes it synchronously-ish.
    useEffect(() => {
        const onPageHide = () => {
            commitDoc();
            void flushAutosave();
        };
        window.addEventListener('pagehide', onPageHide);
        return () => window.removeEventListener('pagehide', onPageHide);
    }, [commitDoc, flushAutosave]);

    // Abandon a half-open transient gesture if the preview unmounts mid-gesture
    // (view switch, doc close). The transient updates have already mutated
    // `currentDoc`, so COMMIT (don't drop) so the edit stays undoable and is
    // autosaved — matching `ObjectTab`'s unmount behaviour (should-fix #9).
    // `commitDoc` no-ops if the baseline belongs to another doc.
    useEffect(() => () => commitDoc(), [commitDoc]);

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
                {/* Background overlays (silhouette, grid, guides, keep-out) first,
                    so label content and the Transformer paint on top of them. */}
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
                <Layer ref={layerRef} {...sceneAttrs}>
                    {resolved.map((node) => (
                        <ResolvedShape
                            key={node.id}
                            node={node}
                            registerRef={registerRef}
                            selected={selectedNodeIds.includes(node.id)}
                            warn={keepOutIds.includes(node.id)}
                            assets={assets}
                            warnings={warnings}
                            assetLabels={assetLabels}
                        />
                    ))}
                    <Transformer
                        ref={transformerRef}
                        rotateEnabled
                        keepRatio={selectedNodesPreserveAspect}
                        onTransformStart={() => {
                            transformingRef.current = true;
                            // Capture the anchor now: Konva tears its active
                            // anchor down while ending the gesture.
                            const transformer = transformerRef.current;
                            activeAnchorRef.current = transformer ? transformer.getActiveAnchor() : null;
                        }}
                        onTransformEnd={handleTransformEnd}
                        borderStroke="#3b82f6"
                        anchorStroke="#3b82f6"
                        anchorSize={10}
                    />
                </Layer>
            </Stage>

            {rulersVisible && <Rulers viewport={viewport} backingW={backing.backingW} backingH={backing.backingH} />}

            {blocked && (
                <div
                    role="status"
                    data-testid="template-blocked"
                    className="pointer-events-none absolute top-2 left-2 z-30 rounded border border-red-700 bg-red-900/80 px-2 py-1 text-xs text-red-100"
                >
                    {t('editor.mfp.templateBlocked')}
                </div>
            )}

            {needsApproval && (
                <div
                    role="status"
                    data-testid="template-needs-approval"
                    className="pointer-events-none absolute top-2 left-2 z-30 rounded border border-amber-700 bg-amber-900/80 px-2 py-1 text-xs text-amber-100"
                >
                    {t('editor.mfp.templateNeedsApproval')}
                </div>
            )}

            {templateErrors && templateErrors.size > 0 && (
                <div
                    role="status"
                    data-testid="template-errors"
                    className="pointer-events-none absolute top-8 left-2 z-30 max-w-xs rounded border border-red-700 bg-red-900/80 px-2 py-1 text-xs text-red-100"
                >
                    {t('editor.mfp.templateErrors', { count: templateErrors.size })}
                </div>
            )}

            {sampleRowError && (
                <div
                    role="status"
                    data-testid="sample-row-error"
                    className="pointer-events-none absolute bottom-2 left-2 z-30 max-w-xs rounded border border-red-700 bg-red-900/80 px-2 py-1 text-xs text-red-100"
                >
                    {t('editor.mfp.sampleRowError', { message: sampleRowError })}
                </div>
            )}

            {globalWarnings.length > 0 && (
                <div
                    role="status"
                    data-testid="global-warnings"
                    className="pointer-events-none absolute top-2 right-2 z-30 max-w-xs rounded border border-amber-700 bg-amber-900/80 px-2 py-1 text-xs text-amber-100"
                >
                    {globalWarnings.map((warning) => (
                        <div key={`${warning.name}:${warning.kind}`}>
                            {t('editor.mfp.globalWarning', { name: warning.name, kind: warning.kind })}
                        </div>
                    ))}
                </div>
            )}

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

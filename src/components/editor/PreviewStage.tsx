import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layer, Line, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { flattenResolved, resolve, DEFAULT_FONT_FAMILY } from '../../editor/render/resolve';
import type { ResolvedContent, ResolvedNode } from '../../editor/render/resolve';
import type { GlobalWarning } from '../../templates/globals';
import { buildFontWarnings, buildPreviewWarnings } from '../../editor/previewWarnings';
import type { LabelDoc, Node, TextNode } from '../../core/doc/types';
import { matrixToKonvaAttrs } from '../../editor/render/konvaFactory';
import { movePatch, transformEndPatch, commitPreservesAspect, transformerTargetSize, dragOriginOf, type DragOrigin } from '../../editor/transformGesture';
import { nodeSize, pointsExtent, preservesAspectByDefault, DEFAULT_CONTENT_SIZE, DEFAULT_FONT_SIZE, type Size } from '../../core/doc/geometry';
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
import { resolveZoom, centeredViewport, zoomAt, ZOOM_MIN, ZOOM_MAX } from '../../editor/viewportController';
import { classifyWheel } from '../../editor/wheelIntent';
import { createNodeForInsert, createPolygonNode } from '../../editor/insertActions';
import { finishPolygonPoints, snapPolygonPointIfEnabled, type PolygonPoint } from '../../editor/polygonDrawing';
import { pointerDownSelection, nodesInMarquee } from '../../editor/selectionModel';
import { DEFAULT_SHAPE_STROKE, DEFAULT_SHAPE_STROKE_WIDTH } from '../../core/doc/objects';
import { isTypingTarget } from '../../utils/keyboardTarget';
import { ResolvedShape } from './ResolvedShape';
import { TextEditorOverlay, useTextEditor, computeScreenPlacement } from './TextEditorOverlay';
import { bytesProviderFor, usePreparedAssets } from './usePreparedAssets';
import { fontBadges } from '../../editor/render/fontAssets';
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
 * Pointer interaction has automated coverage (`PreviewStage.interaction.test.tsx`),
 * which mounts the stage on the canvas shim and fires Konva events directly; the
 * math the handlers call still lives in unit-tested pure modules
 * (`viewportController`, `selectionModel`, `core/viewport`).
 */

const SNAP_THRESHOLD_PX = 6;
const RULER_GUTTER = 24;
/**
 * Movement (in screen px) a pointer must travel before a pointer-down on an
 * already-selected node counts as a drag rather than a click. Below it the
 * gesture collapses the selection to the hit node on release; OS/touch jitter
 * routinely moves a click a pixel or two, so this must be non-zero.
 */
const COLLAPSE_DRAG_THRESHOLD_PX = 3;

/** The four diagonal Transformer anchors (Konva's default is all eight). */
const CORNER_ANCHORS: string[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

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
    /**
     * A plain pointer-down on an already-selected node keeps the whole selection
     * so the drag moves all of it; this id is where the selection collapses if
     * the gesture turns out to be a click (no movement). `null` otherwise.
     */
    collapseTo: string | null;
    /** Set once the pointer has travelled past the click/drag threshold. */
    moved: boolean;
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
    const setEditorWarnings = useStore((state) => state.setEditorWarnings);
    const clearEditorWarnings = useStore((state) => state.clearEditorWarnings);
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
    const setManualZoom = useStore((state) => state.setManualZoom);
    const recenterToken = useStore((state) => state.recenterToken);
    const setEffectiveZoom = useStore((state) => state.setEffectiveZoom);
    const screenDpi = useStore((state) => state.screenDpi);
    const gridSpacingHm = useStore((state) => state.gridSpacingHm);
    const resourceRepo = useStore((state) => state.resourceRepo);

    const containerRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<Konva.Stage>(null);
    const layerRef = useRef<Konva.Layer>(null);
    const transformerRef = useRef<Konva.Transformer>(null);
    const nodeRefs = useRef(new Map<string, Konva.Node>());
    /** Latest resolved world bounds, read by drag start without re-binding. */
    const nodeBoundsRef = useRef<Map<string, ViewRect>>(new Map());
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1, rotation: 0 });
    /**
     * The zoom a wheel gesture just wrote, set by `handleWheel` and consumed by
     * the recenter effect. The wheel writes a pointer-anchored viewport and the
     * store's `setManualZoom` flips the derived `zoom` to the same value; that
     * one effect run must survive, while every other change to `zoom` (toolbar
     * step, Fit/Real, rotation, backing or pane resize) must recentre. The token
     * is one-shot: the effect clears it on read, so a later rotation or resize
     * can never be mistaken for the wheel's own run.
     */
    const wheelZoomRef = useRef<number | null>(null);
    /** Token value the recenter effect last observed (forces a re-derive on bump). */
    const lastRecenterTokenRef = useRef(recenterToken);
    const [marquee, setMarquee] = useState<MarqueeState | null>(null);
    const [snapLines, setSnapLines] = useState<SnapGuideLine[]>([]);
    const [polygonPoints, setPolygonPoints] = useState<PolygonPoint[]>([]);
    const [polygonCursor, setPolygonCursor] = useState<PolygonPoint | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const panRef = useRef<{ startScreen: Point; startPan: Point } | null>(null);
    /** Last shift/alt state; `transformend` has no event modifiers of its own. */
    const modifierRef = useRef(false);
    /** A Transformer gesture is live (armed at transformstart, cleared at end). */
    const transformingRef = useRef(false);
    /**
     * Set while `abortTransform` unwinds a gesture: `handleTransformEnd` must
     * revert to the committed doc instead of committing the abandoned live scale.
     */
    const abortingRef = useRef(false);
    /**
     * The anchor the live Transformer gesture started on. Konva tears its own
     * active anchor (`_movingAnchorName`) down while ending the gesture, so
     * capture it at `transformstart` rather than rely on that teardown ordering
     * — the commit needs it to know corner (aspect) vs side (free-stretch) (#13).
     */
    const activeAnchorRef = useRef<string | null>(null);
    /**
     * Set by the Transformer `onTransform` handler for a single-text selection,
     * where the live gesture is implemented as the Konva "resize without
     * scaling" recipe: the box is scaled imperatively and the node scale is
     * reset. `handleTransformEnd` reads the live `width()/height()` (not
     * `base × scale`) when this is set. Cleared at gesture start and end.
     */
    const boxOnlyTextRef = useRef(false);

    // Inline WYSIWYG text editing (P5). The hook owns the session and all store
    // wiring (transient typing + single-entry commit/restore); this component
    // only opens the editor on a double-click, hides the node being edited and
    // mounts the positioned overlay.
    const {
        editing,
        begin: beginTextEdit,
        setText: setTextFromHook,
        commit: commitTextEdit,
        cancel: cancelTextEdit,
    } = useTextEditor();

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
    // A wheel zoom writes a pointer-anchored viewport and flips the store to
    // `manual` at the same zoom, so the derived `zoom` matches the live zoom.
    // `wheelZoomRef` records that exact zoom for exactly one effect run: the
    // skip below consumes it, so the anchored viewport survives the wheel while
    // every other `zoom` change (toolbar step, rotation, backing/resize)
    // recentres normally. An explicit Fit/Real pick bumps `recenterToken` so it
    // always re-derives/recenters, even when the mode was already active.
    useEffect(() => {
        if (!backing || innerSize.w <= 1) return;
        const forced = recenterToken !== lastRecenterTokenRef.current;
        lastRecenterTokenRef.current = recenterToken;
        const anchored = wheelZoomRef.current;
        wheelZoomRef.current = null; // consumed: only the wheel's own run may skip
        if (!forced && anchored !== null && Math.abs(anchored - zoom) < 1e-6) return;
        setViewport(centeredViewport(zoom, backing, innerSize, viewRotation));
    }, [zoom, recenterToken, viewRotation, backing, innerSize]);

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
            if (node.type === 'image') map.set(node.id, imageNames.get(node.imageId) || node.name || node.imageId || node.id);
            else if (node.type === 'qr' || node.type === 'barcode') map.set(node.id, node.name ?? node.id);
        }
        return map;
    }, [doc, flatResolved]);

    const targets = useMemo<HitTestable[]>(
        () => flatResolved.map((node) => ({ id: node.id, bounds: node.bounds, visible: node.visible, locked: node.locked })),
        [flatResolved],
    );
    const guides = useMemo(() => (doc ? resolveGuides(doc) : []), [doc]);
    const keepOutIds = useMemo(() => {
        if (!doc) return [];
        // Symbols/images are drawn `contain`, so sample the fitted drawn rect
        // (from the prepared asset sizes) rather than the raw box; a letterboxed
        // symbol whose box exceeds its content must not falsely warn.
        const assetSizes = new Map<string, { widthPx: number; heightPx: number }>();
        for (const [id, asset] of assets) {
            assetSizes.set(id, { widthPx: asset.widthPx, heightPx: asset.heightPx });
        }
        return nodesIntersectNonPrintable(doc, assetSizes.size > 0 ? assetSizes : undefined);
    }, [doc, assets]);
    // Preview warnings are aggregated by the pure `buildPreviewWarnings` and
    // published under `preview`, scoped to the document id. The effect owns the
    // cleanup: on doc change/unmount it drops only the group it published, so a
    // re-mounted producer can never clear a newer group.
    useEffect(() => {
        if (!doc) {
            clearEditorWarnings('preview');
            return;
        }
        const docId = doc.meta.id;
        setEditorWarnings('preview', {
            docId,
            scopeId: docId,
            warnings: buildPreviewWarnings(doc, {
                assetWarnings: warnings,
                assetLabels,
                keepOutIds,
                globalWarnings,
                templateErrors,
                blocked,
                needsApproval,
                sampleRowError,
            }),
        });
        return () => clearEditorWarnings('preview', docId);
    }, [doc, warnings, keepOutIds, assetLabels, globalWarnings, templateErrors, blocked, needsApproval, sampleRowError, setEditorWarnings, clearEditorWarnings]);
    // Font availability is a preview-scope producer (the tab is a pure reader).
    // It runs on the always-mounted stage, is scoped to the document id, and
    // swallows provider failures. StrictMode-safe: the cancelled flag drops a
    // stale pass, and the cleanup removes only this document's group.
    //
    // Keyed on the stable font inputs — the document id, the font resource set
    // and the fontIds text nodes actually reference — rather than whole-doc
    // identity. `updateNodeTransient` mints a new `currentDoc` on every
    // pointer-move, so a `doc`-keyed effect re-ran `fontBadges` (IndexedDB
    // reads) and cleared+republished the group every frame of a drag.
    const referencedFontKeys = useMemo(() => (doc?.nodes ?? [])
        .filter((node): node is TextNode => node.type === 'text' && !!node.fontId)
        .map((node) => `${node.id}:${node.fontId}`)
        .sort()
        .join('\n'), [doc]);
    useEffect(() => {
        if (!doc) {
            clearEditorWarnings('fonts');
            return;
        }
        const docId = doc.meta.id;
        let cancelled = false;
        const bytes = resourceRepo ? bytesProviderFor(resourceRepo) : { getBytes: async () => null };
        fontBadges(doc, bytes)
            .then((badges) => {
                if (cancelled) return;
                setEditorWarnings('fonts', { docId, scopeId: docId, warnings: buildFontWarnings(doc, badges) });
            })
            .catch(() => {
                if (!cancelled) setEditorWarnings('fonts', { docId, scopeId: docId, warnings: [] });
            });
        return () => {
            cancelled = true;
            clearEditorWarnings('fonts', docId);
        };
    }, [doc?.meta.id, doc?.resources.fonts, referencedFontKeys, resourceRepo, setEditorWarnings, clearEditorWarnings]);
    /** World bounds per resolved node — used for keep-out badges and drag snap. */
    const nodeBoundsById = useMemo(() => {
        const map = new Map<string, ViewRect>();
        for (const node of flatResolved) map.set(node.id, node.bounds);
        return map;
    }, [flatResolved]);
    const keepOutBounds = nodeBoundsById;
    const polygonDraftPoint = useMemo(() => {
        if (!polygonCursor) return null;
        // Clamp to the backing like a committed click (see `handlePointerDown`)
        // so the dashed preview never runs off-label while every vertex stays legal.
        const cursor: PolygonPoint = doc
            ? [
                  Math.min(Math.max(polygonCursor[0], 0), doc.label.backingW),
                  Math.min(Math.max(polygonCursor[1], 0), doc.label.backingH),
              ]
            : polygonCursor;
        return snapPolygonPointIfEnabled(
            cursor,
            doc,
            [...nodeBoundsById.values()],
            SNAP_THRESHOLD_PX / viewport.zoom,
            gridSpacingHm,
            snapEnabled,
        );
    }, [polygonCursor, snapEnabled, doc, nodeBoundsById, viewport.zoom, gridSpacingHm]);
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
        // `editing?.id` is load-bearing: hiding the edited node happens in JSX
        // (the `resolved` array is referentially unchanged), so without this the
        // effect would not re-run to detach the Transformer from the now-hidden
        // node on session open, nor reattach it on close. `refsReady` ignores the
        // dep; the callback-ref map already handles the mount/unmount.
    }, [selectedNodeIds, resolved, doc, editing?.id]);

    // Live Transformer ratio matches the aspect rule applied at commit (§13):
    // uniform for a single ellipse/image/QR, free otherwise (mixed selections
    // cannot carry one locked ratio). Shift/Alt inverts it at commit time.
    const selectedNodesPreserveAspect = useMemo(() => {
        if (selectedNodeIds.length !== 1 || !doc) return false;
        const node = doc.nodes.find((n) => n.id === selectedNodeIds[0]);
        return node ? preservesAspectByDefault(node) : false;
    }, [selectedNodeIds, doc]);

    // A single selected text node drives the box-only live-resize recipe (item 6):
    // glyphs keep their size, only the box reflows. Read from the committed doc,
    // which stays at the pre-gesture baseline throughout the transform.
    const boxOnlyTextSource = useMemo<TextNode | null>(() => {
        if (selectedNodeIds.length !== 1 || !doc) return null;
        const node = doc.nodes.find((n) => n.id === selectedNodeIds[0]);
        return node && node.type === 'text' ? node : null;
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

    const finishPolygon = useCallback((): boolean => {
        const points = finishPolygonPoints(polygonPoints);
        const node = points ? createPolygonNode(points) : null;
        if (!node) {
            setPolygonPoints([]);
            setPolygonCursor(null);
            clearActiveTool();
            return false;
        }
        const id = addNode(node);
        if (id) selectNode(id);
        setPolygonPoints([]);
        setPolygonCursor(null);
        clearActiveTool();
        return true;
    }, [polygonPoints, addNode, selectNode, clearActiveTool]);

    /** Drop a half-drawn polygon without disarming the tool. */
    const resetPolygonDraft = useCallback(() => {
        setPolygonPoints([]);
        setPolygonCursor(null);
    }, []);

    useEffect(() => {
        if (activeTool !== 'shape:polygon') {
            setPolygonPoints([]);
            setPolygonCursor(null);
        }
    }, [activeTool]);

    // A draft armed on label A must never leak into label B. Keyed on the doc
    // id (not whole-doc identity): a transient drag repaints `currentDoc` but
    // keeps the same id, so this must not fire mid-gesture.
    useEffect(() => {
        resetPolygonDraft();
    }, [doc?.meta.id, resetPolygonDraft]);

    const beginDrag = useCallback(
        (world: Point, ids: readonly string[], collapseTo: string | null = null) => {
            const origins = new Map<string, DragOrigin>();
            const bounds = new Map<string, ViewRect>();
            if (!doc) return;
            for (const id of ids) {
                const node = doc.nodes.find((entry) => entry.id === id);
                if (node) origins.set(id, dragOriginOf(node));
                const box = nodeBoundsRef.current.get(id);
                if (box) bounds.set(id, box);
            }
            dragRef.current = { startWorld: world, origins, bounds, collapseTo, moved: false };
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

            // Polygon is a multi-click drawing gesture; all other inserts remain one-shot.
            if (activeTool === 'shape:polygon') {
                const raw = screenToHm(stage.getPointerPosition()!, viewport);
                // The Stage spans the whole pane, so a click in the grey surround
                // must not add an out-of-label vertex (round-1 keep-out warning).
                // Clamp to the backing rather than dropping the click.
                const point: PolygonPoint = [
                    Math.min(Math.max(raw.x, 0), doc.label.backingW),
                    Math.min(Math.max(raw.y, 0), doc.label.backingH),
                ];
                const snapped = snapPolygonPointIfEnabled(
                    point,
                    doc,
                    [...nodeBoundsById.values()],
                    SNAP_THRESHOLD_PX / viewport.zoom,
                    gridSpacingHm,
                    snapEnabled,
                );
                if (polygonPoints.length >= 3 && Math.hypot(snapped[0] - polygonPoints[0][0], snapped[1] - polygonPoints[0][1]) <= SNAP_THRESHOLD_PX / viewport.zoom) {
                    finishPolygon();
                    return;
                }
                // A double-click's second pointerdown (`detail === 2`) must not
                // append a vertex: dedupe only removes *adjacent* duplicates, so
                // a sliver spike would otherwise survive. `onDblClick` finishes.
                if (event.evt.detail < 2) {
                    setPolygonPoints((points) => [...points, snapped]);
                    setPolygonCursor(snapped);
                }
                return;
            }
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
            const { selection, collapseTo } = pointerDownSelection(selectedNodeIds, hitId, additive);

            if (hitId !== null) {
                // Only rewrite the selection when it actually changed: a plain
                // pointer-down on an already-selected node must keep the whole
                // selection (so the drag moves all of it) and defer the
                // click-to-focus collapse to `finalizeGesture`.
                const changed =
                    selection.length !== selectedNodeIds.length ||
                    selection.some((id, index) => id !== selectedNodeIds[index]);
                if (changed) selectNodes(selection);
                // A plain click begins a move of exactly the selection the user
                // now sees (must-fix #11); the deferred collapse is carried into
                // the drag state so a no-move release can apply it.
                if (!additive) beginDrag(world, selection, collapseTo);
                return;
            }

            // Empty canvas: clear (unless additive) and start a marquee.
            if (!additive) clearNodeSelection();
            const pointer = stage.getPointerPosition();
            if (pointer) setMarquee({ start: pointer, current: pointer });
        },
        [doc, pointerWorld, viewport, activeTool, addNode, selectNode, clearActiveTool, selectedNodeIds, selectNodes, clearNodeSelection, beginDrag, targets, snapEnabled, nodeBoundsById, polygonPoints, finishPolygon, gridSpacingHm],
    );

    /**
     * Stage double-click. In the polygon tool it finishes the draft (the
     * existing behaviour); in the select tool it opens the inline text editor
     * when the pointer lands on a text node. A modal dialog owns its own
     * double-clicks, and the hook itself refuses non-static sources and
     * re-entry, so this only routes the gesture.
     */
    const handleDblClick = useCallback(() => {
        if (document.querySelector('dialog[open]')) return;
        if (activeTool === 'shape:polygon') {
            finishPolygon();
            return;
        }
        if (activeTool !== 'select') return;
        const stage = stageRef.current;
        if (!stage) return;
        const world = pointerWorld(stage);
        if (!world) return;
        const hitId = hitTestWorld(world, targets);
        if (!hitId) return;
        const node = doc?.nodes.find((entry) => entry.id === hitId);
        if (node?.type !== 'text') return;
        // Compute the overlay placement from the **live** Konva node: its
        // absolute matrix already includes ancestor group transforms and the
        // content layer's viewport pan/zoom (and view rotation), so the overlay
        // tracks the node under every case. The stage transform does not include
        // the container's CSS ruler-gutter padding, so add it explicitly (same
        // as the marquee rect).
        const konvaNode = nodeRefs.current.get(node.id);
        if (!konvaNode) return;
        const nodeM = konvaNode.getAbsoluteTransform().getMatrix();
        const size = node.size ?? { w: DEFAULT_CONTENT_SIZE, h: DEFAULT_CONTENT_SIZE };
        const gutter = rulersVisible ? RULER_GUTTER : 0;
        const { screenX, screenY, rotation } = computeScreenPlacement(nodeM, gutter, gutter);
        const scaleX = Math.hypot(nodeM[0], nodeM[1]) || 1;
        const scaleY = Math.hypot(nodeM[2], nodeM[3]) || 1;
        beginTextEdit({
            id: node.id,
            screenX,
            screenY,
            unscaledWidth: size.w,
            unscaledHeight: size.h,
            rotation,
            scaleX,
            scaleY,
            fontSize: node.fontSize ?? DEFAULT_FONT_SIZE,
            fontFamily: node.fontFamily ?? DEFAULT_FONT_FAMILY,
            fontStyle: node.fontStyle ?? 'normal',
            lineHeight: node.lineHeight ?? 1,
            align: node.align ?? 'left',
        });
    }, [activeTool, finishPolygon, pointerWorld, targets, doc, beginTextEdit, rulersVisible]);

    const handlePointerMove = useCallback(() => {
        const stage = stageRef.current;
        if (!stage) return;
        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        // Panning owns the pointer while armed. This must precede the polygon
        // cursor branch: the pointerdown handler arms `panRef` on middle-button
        // even mid-draft, so a middle-drag has to keep panning (and not be
        // shadowed by the draft's early return).
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

        if (activeTool === 'shape:polygon' && polygonPoints.length > 0) {
            const world = screenToHm(pointer, viewport);
            const point: PolygonPoint = [world.x, world.y];
            setPolygonCursor(
                snapPolygonPointIfEnabled(
                    point,
                    doc,
                    [...nodeBoundsById.values()],
                    SNAP_THRESHOLD_PX / viewport.zoom,
                    gridSpacingHm,
                    snapEnabled,
                ),
            );
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

            // Distinguish a click from a drag: OS/touch jitter moves the pointer
            // a pixel or two, so require a small screen-space threshold before
            // the gesture counts as a real move. Below it a plain pointer-down on
            // a selected node collapses to that node on release (finalizeGesture).
            if (!drag.moved && Math.hypot(dx, dy) > COLLAPSE_DRAG_THRESHOLD_PX / viewport.zoom) {
                drag.moved = true;
            }
            // Below the threshold this is still a click candidate: move nothing.
            // Running the snap search / `updateNodeTransient` here would shift the
            // node by the jitter and (via `commitDoc` on release) mint an undo
            // entry for a plain click. `finalizeGesture` collapses the selection.
            if (!drag.moved) return;

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
                    grid: gridSpacingHm,
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
    }, [doc, marquee, viewport, snapEnabled, selectedNodeIds, backing, innerSize, nodeBoundsById, updateNodeTransient, activeTool, polygonPoints, gridSpacingHm]);

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
        const drag = dragRef.current;
        const hadGesture = panRef.current !== null || drag !== null || transformingRef.current;
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
        // A plain pointer-down on an already-selected node started a
        // whole-selection move. If the pointer never moved, it was a click, so
        // collapse to the hit node now — the one sanctioned selection change
        // here (must-fix #5 only forbids clearing a fresh selection on release
        // over the MFP/rail; a real drag leaves `collapseTo` unmoved and the
        // selection untouched).
        if (drag && drag.collapseTo && !drag.moved) {
            // Skip the no-op collapse: this runs on every click of an
            // already-selected node, and `selectNodes` mints a fresh array even
            // when the selection is unchanged, forcing a full re-render.
            const live = useStore.getState().selectedNodeIds;
            if (!(live.length === 1 && live[0] === drag.collapseTo)) {
                selectNodes([drag.collapseTo]);
            }
        }
    }, [commitDoc, selectNodes]);

    /**
     * Re-apply each selected non-group node's committed transform from `doc`.
     * Konva's Transformer mutates the node in place and leaves the live scale
     * behind; this is the one place that restores the document's authority.
     * Groups are skipped (never attached to the Transformer — D-10).
     */
    const revertSelectedNodesFromDoc = useCallback(() => {
        if (!doc) return;
        for (const id of selectedNodeIds) {
            const konvaNode = nodeRefs.current.get(id);
            const source = doc.nodes.find((entry) => entry.id === id);
            if (!konvaNode || !source || source.type === 'group') continue;
            konvaNode.position({ x: source.transform.x, y: source.transform.y });
            konvaNode.rotation(source.transform.rotDeg);
            konvaNode.scale({ x: source.transform.scaleX, y: source.transform.scaleY });
            // The box-only text recipe (item 6) writes the box imperatively; a
            // cancel must restore it, or the abandoned live size would linger
            // until the next unrelated re-render.
            if (source.type === 'text') {
                const box = nodeSize(source);
                konvaNode.setAttrs({ width: box.w, height: box.h });
            }
        }
        transformerRef.current?.forceUpdate();
        layerRef.current?.batchDraw();
    }, [doc, selectedNodeIds]);

    /**
     * Abandon a live Transformer gesture without committing it. Konva's
     * Transformer ends a gesture only on `mouseup`/`touchend` (it binds those on
     * `window`, Transformer.js), so if the OS steals the mouse — e.g. Win+Shift+S
     * — no `mouseup` arrives: `transformend` never fires, the live scale stays on
     * the node, the doc is unchanged, and Konva's stale window listeners keep the
     * transform alive on later moves. `pointercancel` is not fired in that case
     * either.
     *
     * `stopTransform()` synchronously fires `transformend` and removes those
     * stale window listeners; `abortingRef` routes that `transformend` to the
     * revert instead of a commit. When Konva was not actually transforming (no
     * anchor mousedown, e.g. a synthetic test), `stopTransform()` fires nothing,
     * so the fallback reverts directly.
     */
    const abortTransform = useCallback(() => {
        if (!transformingRef.current) return;
        abortingRef.current = true;
        try {
            transformerRef.current?.stopTransform();
        } finally {
            abortingRef.current = false;
            // The fallback must live inside `finally`: `stopTransform()` runs
            // user `transformend` handlers synchronously, so a throw from one
            // would otherwise skip this reset and leave the node stuck at its
            // live scale. When `stopTransform()` did fire `transformend`, the
            // abort branch of `handleTransformEnd` has already cleared the flag
            // and reverted, so this is skipped.
            if (transformingRef.current) {
                transformingRef.current = false;
                // This fallback bypasses `handleTransformEnd`, so clear the
                // box-only flag here too — otherwise a later non-text gesture
                // would inherit it and commit against `node.width()`.
                boxOnlyTextRef.current = false;
                revertSelectedNodesFromDoc();
            }
        }
    }, [revertSelectedNodesFromDoc]);

    // Abandon the whole active pointer gesture, then drop any half-drawn
    // polygon draft. `abortTransform` must run **before** `finalizeGesture`: the
    // latter clears `transformingRef`, which would make `abortTransform`
    // early-return and skip the revert. `finalizeGesture` then closes any
    // move/pan gesture (its transient baseline would otherwise stay open — no
    // `pointerup` follows a cancel). Shared by `pointercancel` (e.g. a touch
    // scroll taking over; Konva's Stage never fires it, so the window listener
    // is the only path) and by the OS focus-steal paths below: `blur` and a
    // hidden tab both take the mouse away with no `mouseup` and no
    // `pointercancel`, so a move-drag or pan must be finalized here too — not
    // just a transform — or `dragRef`/`panRef` stay armed and the next
    // `pointermove` teleports the node.
    const cancelActiveGesture = useCallback(() => {
        abortTransform();
        finalizeGesture();
        resetPolygonDraft();
    }, [abortTransform, finalizeGesture, resetPolygonDraft]);

    // Window-level finalizer so a pointer released outside the stage content
    // (over the MFP/rail) still ends the gesture. An OS focus steal (window
    // `blur`) or a hidden tab (`visibilitychange`) takes the mouse away with no
    // `mouseup`, so it cancels the whole active gesture the same way
    // `pointercancel` does. Matched add/remove keeps StrictMode's double-invoke
    // from double-registering.
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.hidden) cancelActiveGesture();
        };
        window.addEventListener('pointerup', finalizeGesture);
        window.addEventListener('pointercancel', cancelActiveGesture);
        window.addEventListener('blur', cancelActiveGesture);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            window.removeEventListener('pointerup', finalizeGesture);
            window.removeEventListener('pointercancel', cancelActiveGesture);
            window.removeEventListener('blur', cancelActiveGesture);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [finalizeGesture, cancelActiveGesture]);

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
            const e = event.evt;
            const intent = classifyWheel(e);

            if (intent !== 'zoom') {
                // Normalise to screen px: pixel deltas 1:1, a line ~16 px, a page spans the pane.
                const pxPerLine = 16;
                const sx = e.deltaMode === 1 ? pxPerLine : e.deltaMode === 2 ? innerSize.w : 1;
                const sy = e.deltaMode === 1 ? pxPerLine : e.deltaMode === 2 ? innerSize.h : 1;
                const dx = e.deltaX * sx;
                const dy = e.deltaY * sy;
                // Some trackpads emit a zero-delta wheel on tap; skip it or
                // `clampPan` allocates a fresh viewport object for nothing.
                if (dx === 0 && dy === 0) return;
                if (intent === 'pan-horizontal') {
                    // Shift+wheel pan horizontally. A mouse reports the gesture on deltaY;
                    // a trackpad that already swapped axes reports it on deltaX — prefer deltaX.
                    const horizontal = e.deltaX !== 0 ? dx : dy;
                    setViewport((v) => clampPan({ ...v, x: v.x - horizontal }, backing, innerSize));
                } else {
                    setViewport((v) => clampPan({ ...v, x: v.x - dx, y: v.y - dy }, backing, innerSize));
                }
                return;
            }

            const pointer = stage.getPointerPosition() ?? { x: innerSize.w / 2, y: innerSize.h / 2 };
            const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewport.zoom * factor));
            setViewport(zoomAt(viewport, pointer, next, backing, innerSize));
            // Mirror the live zoom into the store so `zoomMode` flips to
            // `manual` and the Real/Fit indicators deselect (the reported bug).
            // No `recenterToken` bump — the pointer anchor must survive — so the
            // one-shot token tells the recenter effect to skip exactly this run.
            //
            // Only claim the skip when this notch actually changes the derived
            // zoom: a notch already pinned at a bound (`next === zoom`) leaves the
            // effect deps untouched, so it never runs to consume the token — a
            // stale token would then swallow a later rotation/resize.
            if (next !== zoom) wheelZoomRef.current = next;
            setManualZoom(next);
        },
        [backing, innerSize, viewport, zoom, setManualZoom],
    );

    // Enter finishes a half-drawn polygon; Esc cancels the draft and clears the
    // selection. Both bail while a modal is open or the user is typing in a text
    // control, so neither key ever hijacks an input (Esc must not nuke the draft
    // or the selection mid-typing).
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (document.querySelector('dialog[open]')) return;
            if (isTypingTarget(event)) return;
            if (event.key === 'Enter' && activeTool === 'shape:polygon') {
                event.preventDefault();
                finishPolygon();
                return;
            }
            if (event.key !== 'Escape') return;
            setPolygonPoints([]);
            setPolygonCursor(null);
            clearActiveTool();
            clearNodeSelection();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [clearActiveTool, clearNodeSelection, activeTool, finishPolygon]);

    /**
     * Live box-only text resize (item 6): the Konva "resize without scaling"
     * recipe. The Transformer mutates the node's scale in place; while the
     * selection is a single text node we bake the live scale into the box
     * (`width`/`height`) and reset the node scale to its sign, so the glyphs
     * keep their size and only the box reflows.
     *
     * The multiply-by-current-box is correct because this recipe resets the node
     * scale to its sign (±1) on every event, so `node.width()` always equals the
     * Transformer's current box. Konva's `_fitNodesInto` computes the live scale
     * as `delta = newTr · oldTr⁻¹` from the node's *current* transform, i.e. a
     * delta relative to that box — reading the gesture-start base would compound
     * it. The resolved doc is not re-rendered mid-gesture, so these imperative
     * attrs persist until `handleTransformEnd` commits and react-konva
     * re-applies `width`/`height` from the new box.
     */
    const handleTransform = useCallback(() => {
        if (!boxOnlyTextSource) return;
        // A rotation-only gesture has no resize to bake; leave the box/scale
        // alone and let `handleTransformEnd` commit the rotation normally.
        if (activeAnchorRef.current === 'rotater') return;
        const konvaNode = nodeRefs.current.get(boxOnlyTextSource.id);
        if (!konvaNode) return;
        const scaleX = konvaNode.scaleX();
        const scaleY = konvaNode.scaleY();
        konvaNode.setAttrs({
            width: konvaNode.width() * Math.abs(scaleX),
            height: konvaNode.height() * Math.abs(scaleY),
            // Preserve the flip sign, matching the commit's scale collapse.
            scaleX: Math.sign(scaleX) || 1,
            scaleY: Math.sign(scaleY) || 1,
        });
        boxOnlyTextRef.current = true;
    }, [boxOnlyTextSource]);

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
            // Read once and clear: a stale flag must never leak into the next
            // (non-text) gesture.
            const boxOnly = boxOnlyTextRef.current;
            boxOnlyTextRef.current = false;
            if (!doc) return;
            if (abortingRef.current) {
                // An aborted gesture (pointercancel / OS focus steal) must revert
                // to the committed doc, never commit the abandoned live scale.
                revertSelectedNodesFromDoc();
                return;
            }
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
                // Box-only text (item 6): the live recipe already baked the
                // gesture scale into the node's width/height and reset the scale
                // to its sign, so the box — not `base × scale` — is the commit
                // target. Live equals commit because the same box is what the
                // user saw reflow.
                const target = boxOnly
                    ? { w: konvaNode.width(), h: konvaNode.height() }
                    : transformerTargetSize(base, konvaNode.scaleX(), konvaNode.scaleY());
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
                // Konva's Transformer mutates the selected node's own scale in
                // place during a gesture and never resets it. On the commit
                // re-render React-Konva skips re-applying an unchanged
                // `scaleX`/`scaleY` prop (strict mode off), so the node would
                // keep the gesture scale `k` and render at `base·k²`. Reset the
                // node's own scale here — preserving the flip sign — so the
                // committed geometry is the single source of the size. The
                // Transformer's chrome re-sync here relies on the commit
                // re-render re-running the attach effect; `forceUpdate` is called
                // explicitly below so the reset is not merely incidental.
                konvaNode.scale({ x: Math.sign(liveScaleX) || 1, y: Math.sign(liveScaleY) || 1 });
                const scaleX = Math.abs(liveScaleX);
                const scaleY = Math.abs(liveScaleY);
                const liveUniform = Math.abs(scaleX - scaleY) <= 1e-6 * Math.max(1, scaleX, scaleY);
                // Mirror the live ratio decision exactly — see
                // `commitPreservesAspect`: an aspect-default node's corner always
                // ran uniform (`keepRatio` on), so `liveUniform` is authoritative
                // there; a non-aspect corner locked only when a modifier forced
                // it, guarded by `liveUniform` to separate Shift from Alt.
                //
                // Box-only text is always free: the live glyph size is constant
                // (the recipe resets the scale), so holding the ratio at commit
                // would scale `fontSize` and diverge from what was shown live.
                const preserveAspect = boxOnly
                    ? false
                    : commitPreservesAspect(
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
            // Explicit chrome re-sync: the reset above relies on the commit
            // re-render (and the attach effect) rather than any guarantee from
            // the node's `*Change` events, so force it here.
            transformerRef.current?.forceUpdate();
        },
        [doc, selectedNodeIds, selectedNodesPreserveAspect, updateNodeTransient, commitDoc, revertSelectedNodesFromDoc],
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
    // The overlay mirrors the edited node's wrap mode; read it from the live
    // doc (a non-text session, if any ever reached the overlay, defaults to word).
    const editingNode = editing ? doc.nodes.find((entry) => entry.id === editing.id) : undefined;
    const editingWrap = editingNode?.type === 'text' ? editingNode.wrap ?? 'word' : 'word';
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
                onPointerLeave={resetPolygonDraft}
                onDblClick={handleDblClick}
                onWheel={handleWheel}
            >
                {/* Background overlays (silhouette, grid, guides, keep-out) first,
                    so label content and the Transformer paint on top of them. */}
                <Overlays
                    doc={doc}
                    guides={guides}
                    showGrid={gridVisible}
                    gridStepHm={gridSpacingHm}
                    snapLines={snapLines}
                    keepOutIds={keepOutIds}
                    keepOutBounds={keepOutBounds}
                    layerAttrs={sceneAttrs}
                />
                <Layer ref={layerRef} {...sceneAttrs}>
                    {polygonPoints.length > 0 && polygonDraftPoint && (
                        <Line
                            // Close the draft back to the first vertex so the
                            // closing edge is visible while drawing. Path:
                            // v0→…→vn→cursor→v0.
                            points={[
                                ...polygonPoints.flatMap(([x, y]) => [x, y]),
                                polygonDraftPoint[0],
                                polygonDraftPoint[1],
                                polygonPoints[0][0],
                                polygonPoints[0][1],
                            ]}
                            // Same style source as `createPolygonNode`, so the
                            // draft previews the committed polygon's ink.
                            stroke={DEFAULT_SHAPE_STROKE}
                            strokeWidth={DEFAULT_SHAPE_STROKE_WIDTH}
                            lineCap="round"
                            lineJoin="round"
                            // Dashed to read as a draft, not a committed shape.
                            dash={[DEFAULT_SHAPE_STROKE_WIDTH * 2, DEFAULT_SHAPE_STROKE_WIDTH]}
                            listening={false}
                        />
                    )}
                    {resolved.map((node) =>
                        editing?.id === node.id ? null : (
                            <ResolvedShape
                                key={node.id}
                                node={node}
                                registerRef={registerRef}
                                selected={selectedNodeIds.includes(node.id)}
                                warn={keepOutIds.includes(node.id)}
                                assets={assets}
                                warnings={warnings}
                                assetLabels={assetLabels}
                                strokeScale={viewport.zoom}
                            />
                        ),
                    )}
                    <Transformer
                        ref={transformerRef}
                        rotateEnabled
                        keepRatio={selectedNodesPreserveAspect}
                        // A single aspect-default node (qr/image/ellipse) may only
                        // resize from the four corners, so a side handle can never
                        // commit a non-uniform box. Everything else (text, mixed
                        // selections) keeps Konva's default all-eight free resize.
                        enabledAnchors={selectedNodesPreserveAspect ? CORNER_ANCHORS : undefined}
                        onTransformStart={() => {
                            transformingRef.current = true;
                            // A fresh gesture never inherits the previous text
                            // box-only flag.
                            boxOnlyTextRef.current = false;
                            // Capture the anchor now: Konva tears its active
                            // anchor down while ending the gesture.
                            const transformer = transformerRef.current;
                            activeAnchorRef.current = transformer ? transformer.getActiveAnchor() : null;
                        }}
                        onTransform={handleTransform}
                        onTransformEnd={handleTransformEnd}
                        borderStroke="#3b82f6"
                        anchorStroke="#3b82f6"
                        anchorSize={10}
                    />
                </Layer>
            </Stage>

            {rulersVisible && <Rulers viewport={viewport} backingW={backing.backingW} backingH={backing.backingH} />}

            {editing && (
                <TextEditorOverlay
                    session={editing}
                    wrap={editingWrap}
                    onChange={setTextFromHook}
                    onCommit={commitTextEdit}
                    onCancel={cancelTextEdit}
                />
            )}

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

            {activeTool === 'shape:polygon' && (
                <div role="status" className="pointer-events-none absolute bottom-2 right-2 z-30 rounded border bg-white/90 px-2 py-1 text-xs text-gray-700">
                    {t('editor.insert.polygonHint', { count: polygonPoints.length })}
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

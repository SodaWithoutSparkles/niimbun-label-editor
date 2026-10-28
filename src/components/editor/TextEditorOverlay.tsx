import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TextWrap } from '../../core/doc/objects';
import type { LabelDoc, TextAlign } from '../../core/doc/types';
import { fontStyleOf, fontWeightOf } from '../../editor/textStyle';
import { shrinkScaleOf } from '../../editor/render/textMetrics';
import { useStore } from '../../store/useStore';

/**
 * Inline WYSIWYG text editing for a static text node (phase P5).
 *
 * Ported from the template-webui reference (`TextEditorOverlay.tsx` +
 * `hooks/useTextEditor.ts`), adapted to this repo's `LabelDoc` model and its
 * transient-gesture undo seam: `useTextEditor` owns the session and all store
 * wiring, while `TextEditorOverlay` is a presentational `<textarea>` a parent
 * mounts inside the stage container. The parent (PreviewStage) hides the node
 * being edited; this file never touches shared rendering code.
 *
 * A `<textarea>`'s native caret is ~1 px and cannot be thickened, so we render a
 * synthetic caret. The textarea and the caret live in one **wrapper** that
 * carries the node transform (rotate+scale), so both are placed in *unscaled
 * layout px* and the wrapper transform scales/rotates them together. Opening the
 * editor seeds the caret from the double-click point.
 */

/** One live editing session, positioned in container-relative screen px. */
export interface TextEditorSession {
    id: string;
    screenX: number;
    screenY: number;
    /** Node box width in hm (pre-scale); CSS `scaleX` renders the screen size. */
    unscaledWidth: number;
    /** Node box height in hm (pre-scale); CSS `scaleY` renders the screen size. */
    unscaledHeight: number;
    rotation: number;
    /** Per-axis screen scale, applied by CSS so glyphs match Konva. */
    scaleX: number;
    scaleY: number;
    fontSize: number;
    fontFamily: string;
    fontStyle: string;
    lineHeight: number;
    /**
     * Extra inter-character spacing in px, mirroring the rendered node. The live
     * `shrink` measurement must include it or the overlay drifts from Konva.
     * Defaults to `0`.
     */
    letterSpacing?: number;
    align: TextAlign;
    text: string;
    /**
     * Double-click point in **node-local hm**: `localPointOf(pointer, nodeMatrix)`
     * from the parent, so the seed lands under the pointer even when the node is
     * rotated/scaled.
     */
    clickLocalX: number;
    clickLocalY: number;
}

export interface TextEditorOverlayProps {
    session: TextEditorSession;
    /** Wrap mode of the node being edited; mirrors the on-canvas wrapping. */
    wrap: TextWrap;
    onChange: (text: string) => void;
    onCommit: () => void;
    onCancel: () => void;
}

/**
 * Screen placement of the edited node, for the absolutely-positioned overlay.
 *
 * `nodeAbsoluteMatrix` is the edited node's absolute matrix
 * (`Konva.Node.getAbsoluteTransform().getMatrix()`). Konva composes that matrix
 * by walking up through every parent, so it **already includes** the content
 * layer's viewport pan/zoom/rotation and every ancestor group transform — there
 * is nothing left to compose. `e`/`f` are the node origin in stage-local px;
 * the caller adds the container's ruler-gutter offset (the layer/stage
 * transform does not include the container's CSS padding).
 *
 * Returns the node origin in screen px plus its rotation in degrees; the overlay
 * re-applies the rotation and per-axis scale via CSS, so its layout box stays
 * the node's *unscaled* hm extent.
 */
export const computeScreenPlacement = (
    nodeAbsoluteMatrix: readonly number[],
    offsetX = 0,
    offsetY = 0,
): { screenX: number; screenY: number; rotation: number } => {
    const [a, b, , , e, f] = nodeAbsoluteMatrix;
    const rotation = (Math.atan2(b, a) * 180) / Math.PI;
    return { screenX: e + offsetX, screenY: f + offsetY, rotation };
};

/**
 * Map a stage-local screen point into the node's local hm space by inverting the
 * node's absolute matrix. Used to seed the caret under the double-click.
 */
export const localPointOf = (
    nodeAbsoluteMatrix: readonly number[],
    x: number,
    y: number,
    offsetX = 0,
    offsetY = 0,
): { x: number; y: number } => {
    const [a, b, c, d, e, f] = nodeAbsoluteMatrix;
    const px = x - offsetX - e;
    const py = y - offsetY - f;
    const det = a * d - b * c;
    if (det === 0) return { x: 0, y: 0 };
    return { x: (d * px - c * py) / det, y: (-b * px + a * py) / det };
};

/** Textarea wrapping CSS that mirrors the Konva `wrap` modes that affect flow. */
const wrapStyle = (wrap: TextWrap): React.CSSProperties =>
    wrap === 'char' ? { wordBreak: 'break-all' } : { overflowWrap: 'break-word' };

/**
 * Caret bar thickness as a fraction of the font size, measured in layout px
 * before the wrapper transform scales it. 5% — owner-verified visually against
 * a real browser. Tests derive their expectations from this, so the bar's
 * weight is stated once.
 */
export const CARET_WIDTH_RATIO = 0.05;

/** Reused canvas 2D context for text measurement (created lazily, never drawn). */
let measureCtx: CanvasRenderingContext2D | null = null;
const measurementContext = (): CanvasRenderingContext2D | null => {
    if (measureCtx) return measureCtx;
    if (typeof document === 'undefined') return null;
    measureCtx = document.createElement('canvas').getContext('2d');
    return measureCtx;
};

export interface CaretFont {
    fontSize: number;
    fontFamily: string;
    fontStyle: string;
    lineHeight: number;
}

const lineHeightPxOf = (font: CaretFont): number => font.fontSize * font.lineHeight;

/**
 * Split a wrapped textarea's text into **visual** lines (hard `\n` plus soft
 * wraps at `contentWidth`), returning each line's start offset. Mirrors the
 * textarea/Konva word/char break roughly (a word longer than the line is broken
 * at the overflow point in both modes).
 */
export const wrappedLineStarts = (
    ctx: CanvasRenderingContext2D,
    text: string,
    contentWidth: number,
    font: CaretFont,
    wrap: TextWrap,
): number[] => {
    const fontSpec = `${font.fontStyle} ${font.fontSize}px ${font.fontFamily}`;
    const width = (s: string): number => {
        ctx.font = fontSpec;
        return ctx.measureText(s).width;
    };
    const limit = contentWidth > 0 ? contentWidth : Number.POSITIVE_INFINITY;
    const starts = [0];
    let i = 0;
    while (i < text.length) {
        const ch = text[i]!;
        if (ch === '\n') {
            i += 1;
            starts.push(i);
            continue;
        }
        let j = i;
        let lastSpace = -1;
        while (j < text.length && text[j] !== '\n' && width(text.slice(i, j + 1)) <= limit) {
            if (text[j] === ' ') lastSpace = j;
            j += 1;
        }
        if (j >= text.length || text[j] === '\n') {
            // Consumed to the end of the paragraph.
            i = j;
            continue;
        }
        if (j === i) {
            // A single char wider than the line: advance one char (no wrap point
            // exists) so the loop always makes progress.
            starts.push(i + 1);
            i += 1;
            continue;
        }
        // Overflow: break at the last space (word) or exactly here (char / long word).
        const breakAt = wrap === 'word' && lastSpace > i ? lastSpace + 1 : j;
        i = breakAt;
        starts.push(i);
    }
    return starts;
};

/** Line index + column for a text offset (clamped). */
const lineColOf = (starts: readonly number[], text: string, offset: number): { line: number; col: number } => {
    const clamped = Math.max(0, Math.min(offset, text.length));
    let line = 0;
    for (let li = 0; li < starts.length; li += 1) {
        if (starts[li]! <= clamped) line = li;
        else break;
    }
    return { line, col: clamped - starts[line]! };
};

/**
 * Offset into `text` for a click at `(x, y)` in the textarea's **layout px**
 * space (`x` from the content edge, `y` from the content top).
 */
export const caretFromPoint = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    contentWidth: number,
    font: CaretFont,
    wrap: TextWrap,
    align: TextAlign,
): number => {
    const fontSpec = `${font.fontStyle} ${font.fontSize}px ${font.fontFamily}`;
    const width = (s: string): number => {
        ctx.font = fontSpec;
        return ctx.measureText(s).width;
    };
    const starts = wrappedLineStarts(ctx, text, contentWidth, font, wrap);
    const lineHeightPx = lineHeightPxOf(font);
    const line = Math.max(0, Math.min(Math.floor(y / lineHeightPx), starts.length - 1));
    const start = starts[line]!;
    const end = line + 1 < starts.length ? starts[line + 1]! : text.length;
    const lineText = text.slice(start, end);

    const lineWidth = lineText.length > 0 ? width(lineText || ' ') : 0;
    const originX = align === 'center' ? (contentWidth - lineWidth) / 2 : align === 'right' ? contentWidth - lineWidth : 0;
    const localX = x - originX;

    let col = 0;
    let best = Math.abs(localX);
    for (let k = 1; k <= lineText.length; k += 1) {
        const w = width(lineText.slice(0, k) || ' ');
        const d = Math.abs(localX - w);
        if (d < best) {
            best = d;
            col = k;
        }
    }
    return start + col;
};

/** Caret rectangle (layout px) for `offset`, plus the line's left edge. */
export const caretRectForOffset = (
    ctx: CanvasRenderingContext2D,
    text: string,
    offset: number,
    contentWidth: number,
    font: CaretFont,
    wrap: TextWrap,
    align: TextAlign,
): { left: number; top: number; height: number } => {
    const fontSpec = `${font.fontStyle} ${font.fontSize}px ${font.fontFamily}`;
    const width = (s: string): number => {
        ctx.font = fontSpec;
        return ctx.measureText(s).width;
    };
    const starts = wrappedLineStarts(ctx, text, contentWidth, font, wrap);
    const lineHeightPx = lineHeightPxOf(font);
    const { line, col } = lineColOf(starts, text, offset);
    const start = starts[line]!;
    const end = line + 1 < starts.length ? starts[line + 1]! : text.length;
    const lineText = text.slice(start, end);
    const lineWidth = lineText.length > 0 ? width(lineText || ' ') : 0;
    const originX = align === 'center' ? (contentWidth - lineWidth) / 2 : align === 'right' ? contentWidth - lineWidth : 0;
    const caretX = originX + width(lineText.slice(0, col));
    return { left: caretX, top: line * lineHeightPx, height: lineHeightPx };
};

export const TextEditorOverlay: React.FC<TextEditorOverlayProps> = ({
    session,
    wrap,
    onChange,
    onCommit,
    onCancel,
}) => {
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    // Caret in the textarea's **layout px** (the wrapper transform scales it).
    const [caret, setCaret] = useState<{ left: number; top: number; height: number } | null>(null);

    const font = useMemo<CaretFont>(
        () => ({
            fontSize: session.fontSize,
            fontFamily: session.fontFamily,
            fontStyle: session.fontStyle,
            lineHeight: session.lineHeight,
        }),
        [session.fontSize, session.fontFamily, session.fontStyle, session.lineHeight],
    );

    /**
     * The live `shrink` factor, recomputed from the session text so every
     * keystroke gets the factor the canvas will render. `1` for any other wrap.
     * The overlay owns the shrink (the captured session scale has it divided
     * out by the parent), so the box is laid out at its true size and only the
     * *content* is scaled below.
     */
    const shrink = useMemo(() => {
        if (wrap !== 'shrink') return 1;
        return shrinkScaleOf({
            text: session.text,
            width: session.unscaledWidth,
            height: session.unscaledHeight,
            fontSize: session.fontSize,
            fontFamily: session.fontFamily,
            fontStyle: session.fontStyle,
            lineHeight: session.lineHeight,
            letterSpacing: session.letterSpacing,
        });
    }, [
        wrap,
        session.text,
        session.unscaledWidth,
        session.unscaledHeight,
        session.fontSize,
        session.fontFamily,
        session.fontStyle,
        session.lineHeight,
        session.letterSpacing,
    ]);

    // Layout px per CSS px: the wrapper transform scales, but the textarea's
    // `clientWidth` is in CSS px (transform does not change CSS pixel sizes), so
    // the layout width equals `clientWidth` — no scale division needed here.
    const contentWidth = useCallback((): number => taRef.current?.clientWidth || session.unscaledWidth, [session.unscaledWidth]);

    // A degenerate box (zero width/height) measures to `scale === 0`: `h / 0`
    // and a `scale(0)` inner box would emit `Infinity`/`NaN` and hide the
    // editor. Fall back to 1 for **layout** purposes; the measured factor is
    // used nowhere else. Deliberate consequence: at a zero measure the canvas
    // draws nothing, while the editor stays editable at the natural scale — the
    // only useful behaviour for a zero-size node.
    const layoutShrink = shrink > 0 ? shrink : 1;

    // Caret thickness, in **layout px**. The bar is CARET_WIDTH_RATIO (5%) of the
    // font size — owner-verified as the right visual weight — but the wrapper
    // transform then multiplies it by `scaleX`, which drops it sub-pixel when
    // zoomed out (a faint smeared line) and lets it drift off whole pixels when
    // zoomed in. Round in device space, then convert back, so the painted bar is
    // always whole device pixels wide and never thinner than one. The inner
    // `scale(layoutShrink)` box scales the bar too, so the device scale must
    // include it — otherwise the bar is sub-pixel at a shrink < 1 and too thick
    // at a shrink > 1.
    const deviceScale =
        session.scaleX * layoutShrink * (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    const caretWidth = Math.max(1, Math.round(session.fontSize * CARET_WIDTH_RATIO * deviceScale)) / deviceScale;

    // NOTE (P14): the textarea carries the node's `letterSpacing` as CSS, but the
    // caret paths do not: the re-measure below (`caretRectForOffset` →
    // `wrappedLineStarts`) and the open-time **seed** (`caretFromPoint`) both use
    // a plain `measureText` and never add `letterSpacing × length`, which is how
    // Konva measures. With a non-zero spacing the caret can therefore open under
    // the wrong glyph and then drift by up to `letterSpacing × line length` (and a
    // wrap point can shift). Mirroring it here would mean changing
    // `wrappedLineStarts`/`caretFromPoint`, which is out of scope for P14, so the
    // divergence is documented instead of silently ignored.
    const measure = useCallback(
        (offset: number) => {
            const ta = taRef.current;
            const ctx = measurementContext();
            if (!ta || !ctx) return;
            const rect = caretRectForOffset(ctx, ta.value, offset, contentWidth(), font, wrap, session.align);
            setCaret({ ...rect, top: rect.top - ta.scrollTop });
        },
        [font, wrap, session.align, contentWidth],
    );

    const focusEndpoint = useCallback((ta: HTMLTextAreaElement): number => {
        // A forward selection's active end is `selectionEnd`; a collapsed caret is
        // the same value. Keep the caret on the focus endpoint.
        if (typeof ta.selectionDirection === 'string' && ta.selectionDirection === 'backward') {
            return ta.selectionStart ?? 0;
        }
        return ta.selectionEnd ?? ta.selectionStart ?? 0;
    }, []);

    const syncCaret = useCallback(() => {
        const ta = taRef.current;
        if (ta) measure(focusEndpoint(ta));
    }, [measure, focusEndpoint]);

    // Seed the caret under the double-click point, once, on open. `clickLocalX/Y`
    // are node-local hm (the parent inverted the node matrix), so this is correct
    // for a rotated/scaled node; layout px = local hm × the node's screen scale.
    const seedRef = useRef(false);
    useEffect(() => {
        const ta = taRef.current;
        const ctx = measurementContext();
        if (!ta || !ctx || seedRef.current) return;
        seedRef.current = true;
        const scale = session.scaleX || 1;
        const x = session.clickLocalX * scale;
        const y = session.clickLocalY * scale;
        const offset = caretFromPoint(ctx, ta.value, x, y, contentWidth(), font, wrap, session.align);
        ta.focus();
        ta.setSelectionRange(offset, offset);
        measure(offset);
        // Seed only on the initial mount of a session; edits re-measure below.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-measure when the text changes (caret sits after the inserted char).
    useEffect(() => {
        const ta = taRef.current;
        if (ta) measure(focusEndpoint(ta));
    }, [session.text, measure, focusEndpoint]);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Belt-and-braces: the global shortcut listener already bails on a
        // textarea target, but a tool keybind must never see an in-editor key.
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
            return;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onCommit();
            return;
        }
        // A plain Enter falls through and inserts a newline (native behaviour).
    };

    // The textarea and the synthetic caret are one layout unit: both stay in
    // natural layout px so the caret math is untouched.
    const content = (
        <>
            <textarea
                ref={taRef}
                value={session.text}
                onChange={(event) => onChange(event.target.value)}
                onBlur={onCommit}
                onKeyDown={handleKeyDown}
                onKeyUp={syncCaret}
                onClick={syncCaret}
                onSelect={syncCaret}
                onFocus={syncCaret}
                autoFocus
                style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    boxSizing: 'border-box',
                    fontSize: `${session.fontSize}px`,
                    fontFamily: session.fontFamily,
                    // A node `fontStyle` may be the combined `'bold italic'`,
                    // which the CSS `font-style` longhand rejects. Split it into
                    // the two longhands so the WYSIWYG box paints bold too.
                    fontWeight: fontWeightOf(session.fontStyle),
                    fontStyle: fontStyleOf(session.fontStyle),
                    lineHeight: session.lineHeight,
                    textAlign: session.align,
                    padding: 0,
                    border: 'none',
                    outline: '2px solid #3b82f6',
                    resize: 'none',
                    overflow: 'hidden',
                    background: 'transparent',
                    // Hide the ~1px native caret; the synthetic one is the cursor
                    // (`caret-color` has no width, so it can't be thickened).
                    caretColor: 'transparent',
                    color: '#111827',
                    whiteSpace: 'pre-wrap',
                    // Match Konva's `letterSpacing` so the editor's glyph
                    // spacing and wrap points are the rendered ones. Omitted
                    // entirely at 0, keeping the pre-fix DOM byte-identical.
                    ...(session.letterSpacing ? { letterSpacing: `${session.letterSpacing}px` } : {}),
                    ...wrapStyle(wrap),
                }}
            />
            {caret && (
                <div
                    aria-hidden
                    data-testid="text-editor-caret"
                    key={`${caret.left}-${caret.top}`} // Forces animation restart at 0% on move
                    style={{
                        position: 'absolute',
                        left: `${caret.left}px`,
                        top: `${caret.top}px`,
                        width: `${caretWidth}px`,
                        height: `${caret.height}px`,
                        background: '#0ea5e9',
                        // The enclosing transform scales this bar too, so its
                        // width follows the text at every zoom level.
                        pointerEvents: 'none',
                        transition: 'left 80ms cubic-bezier(0.2, 0, 0, 1), top 80ms ease-out',
                        animation: 'text-editor-caret-blink 1s steps(1, end) infinite',
                    }}
                />
            )}
        </>
    );

    return (
        <div
            data-testid="text-editor-wrapper"
            style={{
                position: 'absolute',
                left: `${session.screenX}px`,
                top: `${session.screenY}px`,
                // The wrapper carries the node transform, so the textarea and the
                // synthetic caret both lay out in unscaled px and transform once.
                // It is the node's **true** box: the parent divided the captured
                // shrink out, and the content is scaled inside instead.
                transform: `rotate(${session.rotation}deg) scale(${session.scaleX}, ${session.scaleY})`,
                transformOrigin: 'top left',
                width: `${session.unscaledWidth}px`,
                height: `${session.unscaledHeight}px`,
                zIndex: 20,
            }}
        >
            {layoutShrink !== 1 ? (
                // Shrink the content, not the box. Width stays the **node box**
                // (`node.w`) so the textarea's wrap is the layout Konva measured;
                // height is `node.h / shrink` so every natural line exists
                // *before* the single `scale(shrink)`. The visible block is then
                // `node.w × shrink` wide and up to `node.h` tall — inside the box,
                // like the canvas. `layoutShrink === 1` keeps the exact pre-fix
                // DOM (no inner box at all).
                <div
                    data-testid="text-editor-inner"
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: `${session.unscaledWidth}px`,
                        height: `${session.unscaledHeight / layoutShrink}px`,
                        transform: `scale(${layoutShrink})`,
                        transformOrigin: 'top left',
                    }}
                >
                    {content}
                </div>
            ) : (
                content
            )}
        </div>
    );
};

export interface UseTextEditor {
    editing: TextEditorSession | null;
    begin: (session: Omit<TextEditorSession, 'text'>) => void;
    setText: (text: string) => void;
    commit: () => void;
    cancel: () => void;
}

/**
 * Own the inline editing session for a static text node.
 *
 * `begin` opens a session from a placement the caller already computed (it owns
 * the live Konva node refs) and captures a deep pre-edit doc snapshot. Typing
 * flows through `updateNodeTransient` (one gesture, no history per keystroke).
 * `commit` ends the gesture with one undo entry; `cancel` restores the snapshot
 * as one undo entry.
 */
export const useTextEditor = (): UseTextEditor => {
    const [editing, setEditing] = useState<TextEditorSession | null>(null);
    // Mirror for callbacks that must read the live session without re-binding.
    const editingRef = useRef<TextEditorSession | null>(null);
    // Doc as it was before the session began; `cancel` restores exactly this.
    const preEditDocRef = useRef<LabelDoc | null>(null);

    const apply = useCallback((next: TextEditorSession | null) => {
        editingRef.current = next;
        setEditing(next);
    }, []);

    const begin = useCallback(
        (session: Omit<TextEditorSession, 'text'>) => {
            // A session already owns the transient gesture and snapshot; a second
            // `begin` must not clobber them (the caller guards too).
            if (editingRef.current) return;
            const doc = useStore.getState().currentDoc;
            if (!doc) return;
            const node = doc.nodes.find((entry) => entry.id === session.id);
            // Only static text is WYSIWYG-editable; csv/template is authored in
            // the Object tab (execution is a later phase).
            if (!node || node.type !== 'text' || node.text.kind !== 'static') return;

            preEditDocRef.current = structuredClone(doc);
            apply({ ...session, text: node.text.value });
        },
        [apply],
    );

    const setText = useCallback(
        (text: string) => {
            const session = editingRef.current;
            if (!session) return;
            apply({ ...session, text });
            // One transient gesture: no history entry per keystroke. `commit`
            // folds the whole typing burst into a single undo entry.
            useStore.getState().updateNodeTransient(session.id, { text: { kind: 'static', value: text } });
        },
        [apply],
    );

    const commit = useCallback(() => {
        if (!editingRef.current) return;
        // One undo entry for the whole session. A no-op session (opened then
        // blurred without edits) leaves no transient baseline, so this creates
        // no dead entry.
        useStore.getState().commitDoc();
        preEditDocRef.current = null;
        apply(null);
    }, [apply]);

    const cancel = useCallback(() => {
        if (!editingRef.current) return;
        const snapshot = preEditDocRef.current;
        if (snapshot) useStore.getState().restoreDoc(snapshot);
        preEditDocRef.current = null;
        apply(null);
    }, [apply]);

    return { editing, begin, setText, commit, cancel };
};

import React, { useCallback, useRef, useState } from 'react';
import type { TextWrap } from '../../core/doc/objects';
import type { LabelDoc, TextAlign } from '../../core/doc/types';
import { useStore } from '../../store/useStore';

/**
 * Inline WYSIWYG text editing for a static text node (phase P5).
 *
 * Ported from the template-webui reference (`TextEditorOverlay.tsx` +
 * `hooks/useTextEditor.ts`), adapted to this repo's `LabelDoc` model and its
 * transient-gesture undo seam: `useTextEditor` owns the session and all store
 * wiring, while `TextEditorOverlay` is a purely presentational `<textarea>` a
 * parent mounts inside the stage container. The parent (PreviewStage) hides the
 * node being edited; this file never touches shared rendering code.
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
    align: TextAlign;
    text: string;
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
 * the node's *unscaled* hm extent (the caller passes `size.w`/`size.h`).
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

/** Textarea wrapping CSS that mirrors the Konva `wrap` modes that affect flow. */
const wrapStyle = (wrap: TextWrap): React.CSSProperties =>
    wrap === 'char' ? { wordBreak: 'break-all' } : { overflowWrap: 'break-word' };

export const TextEditorOverlay: React.FC<TextEditorOverlayProps> = ({
    session,
    wrap,
    onChange,
    onCommit,
    onCancel,
}) => {
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

    return (
        <textarea
            value={session.text}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onCommit}
            onKeyDown={handleKeyDown}
            autoFocus
            style={{
                position: 'absolute',
                left: `${session.screenX}px`,
                top: `${session.screenY}px`,
                width: `${session.unscaledWidth}px`,
                height: `${session.unscaledHeight}px`,
                // `border-box` so width/height are the node box extent, with the
                // padding inset (matching Konva's Text, which draws inside them).
                boxSizing: 'border-box',
                fontSize: `${session.fontSize}px`,
                fontFamily: session.fontFamily,
                fontStyle: session.fontStyle,
                lineHeight: session.lineHeight,
                textAlign: session.align,
                padding: 0,
                border: 'none',
                outline: '2px solid #3b82f6',
                resize: 'none',
                overflow: 'hidden',
                transform: `rotate(${session.rotation}deg) scale(${session.scaleX}, ${session.scaleY})`,
                transformOrigin: 'top left',
                background: 'transparent',
                color: '#111827',
                whiteSpace: 'pre-wrap',
                // Above the canvas layer, below app chrome/popovers.
                zIndex: 20,
                ...wrapStyle(wrap),
            }}
        />
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

import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Eye,
    EyeOff,
    Lock,
    Unlock,
    Type,
    Square,
    Image as ImageIcon,
    Boxes,
    QrCode,
    Barcode,
    ChevronDown,
    ChevronRight,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { cn } from '../../utils/cn';
import { treeRows, type TreeRow } from '../../editor/selectors';
import type { NodeType } from '../../core/doc/types';

/**
 * Object / layers panel (ui-spec.md §7) — right column, row B. Photoshop-style
 * list from `selectors.treeRows` with `{ frontToBack: true }`; top of the list
 * is the front-most node, and group rows carry a chevron that collapses their
 * descendants.
 *
 * Per-row eye + lock toggle the node's **own** flags; inherited state dims the
 * row (`effectiveVisible` / `effectiveLocked`). Selection mirrors the canvas and
 * supports multi-select. Drag-and-drop reparents/reorders via `reparentNode`
 * (its cycle guard rejects illegal drops).
 */

const TYPE_ICONS = {
    group: Boxes,
    text: Type,
    image: ImageIcon,
    shape: Square,
    qr: QrCode,
    barcode: Barcode,
} as const satisfies Record<NodeType, typeof Type>;

export const LayersPanel: React.FC = () => {
    const { t } = useTranslation();
    const doc = useStore((state) => state.currentDoc);
    const selectedNodeIds = useStore((state) => state.selectedNodeIds);
    const selectNode = useStore((state) => state.selectNode);
    const toggleSelectNode = useStore((state) => state.toggleSelectNode);
    const updateNode = useStore((state) => state.updateNode);
    const reparentNode = useStore((state) => state.reparentNode);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const dragId = useRef<string | null>(null);

    const rows = useMemo(() => {
        if (!doc) return [];
        const all = treeRows(doc, { frontToBack: true });
        // Hide descendants of collapsed groups. `all` is depth-first pre-order,
        // so a subtree is exactly the run of rows deeper than the group.
        const visible: TreeRow[] = [];
        let hiddenBelowDepth: number | null = null;
        for (const row of all) {
            if (hiddenBelowDepth !== null && row.depth > hiddenBelowDepth) continue;
            hiddenBelowDepth = null;
            visible.push(row);
            if (row.type === 'group' && collapsedGroups.has(row.id)) hiddenBelowDepth = row.depth;
        }
        return visible;
    }, [doc, collapsedGroups]);

    if (!doc) return null;

    const toggleCollapsed = (id: string) => {
        setCollapsedGroups((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const onRowPointerDown = (event: React.PointerEvent, id: string) => {
        if (event.shiftKey || event.ctrlKey || event.metaKey) toggleSelectNode(id);
        else selectNode(id);
    };

    const onDrop = (row: TreeRow, before: boolean) => {
        const id = dragId.current;
        dragId.current = null;
        setDropTarget(null);
        if (!id || id === row.id || !doc) return;
        const rowNode = doc.nodes.find((node) => node.id === row.id);
        if (!rowNode) return;
        const parentId = rowNode.parentId;
        // The rows list is front-to-back (front-most sibling first) while the
        // `nodes[]` array is back-to-front (array order = z-order), so a drop
        // "before" a row in the list lands one index *later* in the array.
        // Indices are computed against the siblings with the dragged node
        // already removed, which is the array `reparentNode` inserts into.
        const siblings = doc.nodes.filter((node) => node.parentId === parentId && node.id !== id);
        const index = siblings.findIndex((node) => node.id === row.id);
        const target =
            row.type === 'group' && !before
                ? { parentId: row.id, index: Number.MAX_SAFE_INTEGER }
                : { parentId, index: before ? index + 1 : index };
        reparentNode(id, target.parentId, target.index);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-gray-800">
            <div className="bg-gray-900 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gray-300">
                {t('editor.layers.title')}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {rows.length === 0 && (
                    <p className="p-2 text-xs italic text-gray-500">{t('editor.layers.noObjects')}</p>
                )}
                <ul className="space-y-0.5">
                    {rows.map((row) => {
                        const Icon = TYPE_ICONS[row.type];
                        const selected = selectedNodeIds.includes(row.id);
                        const inheritedHidden = !row.effectiveVisible && row.visible;
                        // A row is inherited-locked only when an ANCESTOR is
                        // locked while the row's own flag is off. The previous
                        // `!row.effectiveLocked && !row.locked` was inverted.
                        const inheritedLocked = row.effectiveLocked && !row.locked;
                        const dimmed = !row.effectiveVisible || (row.effectiveLocked && !row.locked);
                        return (
                            <li
                                key={row.id}
                                draggable
                                onDragStart={() => {
                                    dragId.current = row.id;
                                }}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    setDropTarget(row.id);
                                }}
                                onDragLeave={() => setDropTarget((current) => (current === row.id ? null : current))}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    onDrop(row, event.clientY < rect.top + rect.height / 2);
                                }}
                                onPointerDown={(event) => onRowPointerDown(event, row.id)}
                                aria-selected={selected}
                                title={inheritedHidden ? t('editor.layers.inheritedHidden') : inheritedLocked ? t('editor.layers.inheritedLocked') : row.name}
                                className={cn(
                                    'group flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-sm',
                                    selected ? 'bg-blue-900 text-white' : 'text-gray-300 hover:bg-gray-700',
                                    dropTarget === row.id && 'ring-1 ring-blue-400',
                                    dimmed && 'opacity-50',
                                )}
                                style={{ paddingLeft: 4 + row.depth * 12 }}
                            >
                                {row.type === 'group' ? (
                                    <button
                                        type="button"
                                        aria-label={
                                            collapsedGroups.has(row.id)
                                                ? t('editor.layers.expandGroup')
                                                : t('editor.layers.collapseGroup')
                                        }
                                        aria-expanded={!collapsedGroups.has(row.id)}
                                        title={
                                            collapsedGroups.has(row.id)
                                                ? t('editor.layers.expandGroup')
                                                : t('editor.layers.collapseGroup')
                                        }
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            toggleCollapsed(row.id);
                                        }}
                                        className="shrink-0 text-gray-400 hover:text-white"
                                    >
                                        {collapsedGroups.has(row.id) ? (
                                            <ChevronRight size={13} />
                                        ) : (
                                            <ChevronDown size={13} />
                                        )}
                                    </button>
                                ) : (
                                    <span className="w-[13px] shrink-0" aria-hidden />
                                )}
                                <button
                                    type="button"
                                    aria-label={row.visible ? t('editor.layers.hide') : t('editor.layers.show')}
                                    title={row.visible ? t('editor.layers.hide') : t('editor.layers.show')}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        updateNode(row.id, { visible: !row.visible });
                                    }}
                                    className="shrink-0 text-gray-400 hover:text-white"
                                >
                                    {row.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                                </button>
                                <button
                                    type="button"
                                    aria-label={row.locked ? t('editor.layers.unlock') : t('editor.layers.lock')}
                                    title={row.locked ? t('editor.layers.unlock') : t('editor.layers.lock')}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        updateNode(row.id, { locked: !row.locked });
                                    }}
                                    className="shrink-0 text-gray-400 hover:text-white"
                                >
                                    {row.locked ? <Lock size={13} /> : <Unlock size={13} />}
                                </button>
                                <Icon size={13} className="shrink-0 text-gray-500" />
                                <span className="truncate">{row.name ?? t(typeLabelKey(row.type))}</span>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
};

/** Literal map so dynamic node-type keys keep i18next's typed-key union. */
export const TYPE_LABEL_KEYS = {
    group: 'editor.layers.group',
    text: 'editor.insert.text',
    image: 'editor.insert.image',
    shape: 'editor.insert.shape',
    qr: 'editor.insert.qr',
    barcode: 'editor.insert.barcode',
} as const satisfies Record<NodeType, string>;

const typeLabelKey = (type: NodeType) => TYPE_LABEL_KEYS[type];

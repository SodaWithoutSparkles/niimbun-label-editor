import { effectiveVisible, nodeLookup } from '../core/doc/derive';
import type { LabelDoc } from '../core/doc/types';
import type { GlobalWarning } from '../templates/globals';
import type { AssetWarning } from './render/assets';
import type { FontBadge } from './render/fontAssets';
import type { EditorWarning } from './warnings';

/**
 * Pure aggregation for the `preview` warning group (P6 warning center).
 *
 * Extracted from `PreviewStage` because that producer lived inline inside a
 * Konva component and therefore could not be unit-tested (6 of the 13 warning
 * kinds only ran in the browser). The function is side-effect free and takes
 * every input as an argument, so the exact entry list (ids, kinds, labels and
 * jumpability) is asserted without mounting Konva. `PreviewStage` publishes the
 * result through `setEditorWarnings('preview', …)`.
 */
export interface PreviewWarningInputs {
    /** Per resolved asset leaf, keyed by node id (from `usePreparedAssets`). */
    assetWarnings: ReadonlyMap<string, AssetWarning>;
    /** Placeholder label per asset leaf, keyed by node id. */
    assetLabels: ReadonlyMap<string, string>;
    /** Node ids outside the printable region union (`nodesIntersectNonPrintable`). */
    keepOutIds: readonly string[];
    /** Global-data warnings from the sample-row pass. */
    globalWarnings: readonly GlobalWarning[];
    /** Per-node template failures from the sample-row pass, keyed by node id. */
    templateErrors: ReadonlyMap<string, string> | undefined;
    /** The sample row was blocked by trust gating. */
    blocked: boolean;
    /** The sample row needs global-data approval. */
    needsApproval: boolean;
    /** The sample-row pipeline reported a document-level error. */
    sampleRowError: string | null;
}

/**
 * Build the preview warning entries, preserving the original inline ordering
 * (assets, keep-out, globals, template errors, then the document-level flags).
 *
 * Hidden nodes are excluded from keep-out warnings: `nodesIntersectNonPrintable`
 * walks `doc.nodes` and knows nothing about visibility, while both the canvas
 * badge and the asset warnings derive from the resolved tree (which omits hidden
 * subtrees). The exclusion uses `effectiveVisible` so a node inside a hidden
 * group is treated exactly like a hidden node — the raw `visible` flag alone
 * would miss it and emit a warning the canvas never badges.
 */
export const buildPreviewWarnings = (doc: LabelDoc, inputs: PreviewWarningInputs): EditorWarning[] => {
    const entries: EditorWarning[] = [];
    const byId = nodeLookup(doc.nodes);

    for (const [nodeId, kind] of inputs.assetWarnings.entries()) {
        entries.push({
            id: `asset:${nodeId}`,
            kind: 'asset',
            nodeId,
            assetWarning: kind,
            label: inputs.assetLabels.get(nodeId) ?? nodeId,
        });
    }

    for (const nodeId of inputs.keepOutIds) {
        const node = byId.get(nodeId);
        if (node && !effectiveVisible(node, byId)) continue;
        entries.push({ id: `keep-out:${nodeId}`, kind: 'keep-out', nodeId, label: node?.name ?? nodeId });
    }

    for (const warning of inputs.globalWarnings) {
        entries.push({ id: `global:${warning.name}:${warning.kind}`, kind: 'global', name: warning.name, warningKind: warning.kind });
    }

    for (const [nodeId, message] of inputs.templateErrors ?? []) {
        const node = doc.nodes.find((item) => item.id === nodeId);
        entries.push({ id: `template:${nodeId}`, kind: 'template-error', nodeId, label: node?.name ?? nodeId, message });
    }

    if (inputs.blocked) entries.push({ id: 'template:blocked', kind: 'template-blocked' });
    if (inputs.needsApproval) entries.push({ id: 'template:approval', kind: 'template-approval' });
    if (inputs.sampleRowError) entries.push({ id: 'sample-row:error', kind: 'sample-row-error', message: inputs.sampleRowError });

    return entries;
};

/**
 * Pure font-availability aggregation for the `fonts` warning group (P6).
 *
 * A text node is flagged when its `fontId` has no `FontRef` in
 * `doc.resources.fonts` **or** when `fontBadges` classified that font `missing`;
 * a resolvable font with a non-missing badge yields nothing. Non-text nodes and
 * text nodes without a `fontId` are skipped. Extracted from `PreviewStage` so
 * the badge→warning mapping is unit-tested without mounting Konva; the component
 * remains a thin publisher of the result under `'fonts'`.
 */
export const buildFontWarnings = (
    doc: LabelDoc,
    badges: ReadonlyMap<string, FontBadge>,
): EditorWarning[] => {
    const fonts = new Map(doc.resources.fonts.map((font) => [font.fontId, font] as const));
    const entries: EditorWarning[] = [];
    for (const node of doc.nodes) {
        if (node.type !== 'text' || !node.fontId) continue;
        const font = fonts.get(node.fontId);
        if (font && badges.get(node.fontId) !== 'missing') continue;
        entries.push({
            id: `font:${node.id}`,
            kind: 'font-missing',
            nodeId: node.id,
            label: font?.name ?? node.fontId,
        });
    }
    return entries;
};

import { effectiveVisible, nodeLookup } from '../core/doc/derive';
import type { LabelDoc } from '../core/doc/types';
import { resolveQuantizer, type QuantizerByType } from '../core/render';

/**
 * Whether any **printable** node in `doc` resolves to the screentone policy.
 * Pure and render-free: it walks the same hint → per-type default chain the
 * render path uses, so the print dialog can warn about a non-head dpi without
 * paying for a raster.
 *
 * Groups are skipped deliberately — a group carries no pixels of its own, so a
 * hint on one never affects the output. A node hidden by its own `visible` flag
 * or by any ancestor group is skipped too: `resolve` omits hidden subtrees
 * (`effectiveVisible`), so a hidden screentone node never reaches the printer
 * and must not raise the warning. The predicate is the render path's own, not a
 * re-implementation.
 */
export const docUsesScreentone = (
    doc: Pick<LabelDoc, 'nodes'>,
    defaultQuantizerByType?: QuantizerByType,
): boolean => {
    const byId = nodeLookup(doc.nodes);
    return doc.nodes.some(
        (node) =>
            node.type !== 'group' &&
            effectiveVisible(node, byId) &&
            resolveQuantizer(node, defaultQuantizerByType) === 'screentone',
    );
};

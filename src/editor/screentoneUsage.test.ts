import { describe, expect, it } from 'vitest';
import { createLabelDoc } from '../core/doc/factory';
import type { Node } from '../core/doc/types';
import { docUsesScreentone } from './screentoneUsage';

const node = (over: Record<string, unknown>): Node =>
    ({
        id: 'n1',
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        ...over,
    }) as unknown as Node;

const docWith = (nodes: Node[]) =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });

describe('docUsesScreentone', () => {
    it('is true when any node explicitly hints screentone', () => {
        expect(docUsesScreentone(docWith([node({ quantizerHint: 'screentone' })]))).toBe(true);
    });

    it('is true through a per-type default override', () => {
        const doc = docWith([node({ type: 'image', imageId: 'i1' })]);
        expect(docUsesScreentone(doc, { image: 'screentone' })).toBe(true);
    });

    it('is false for threshold/diffusion policies and an empty document', () => {
        expect(docUsesScreentone(docWith([node({ quantizerHint: 'atkinson' })]))).toBe(false);
        expect(docUsesScreentone(docWith([node({})]))).toBe(false);
        expect(docUsesScreentone(docWith([]))).toBe(false);
        // The module default policy map never selects screentone (R10).
        expect(docUsesScreentone(docWith([node({ type: 'text', text: { kind: 'static', value: '' } })]))).toBe(
            false,
        );
    });

    it('ignores a group hint (a group has no pixels of its own)', () => {
        expect(
            docUsesScreentone(docWith([node({ type: 'group', quantizerHint: 'screentone' })])),
        ).toBe(false);
    });

    it('ignores a directly hidden screentone node', () => {
        expect(
            docUsesScreentone(
                docWith([node({ visible: false, quantizerHint: 'screentone' })]),
            ),
        ).toBe(false);
    });

    it('ignores a screentone node hidden by an ancestor group', () => {
        const doc = docWith([
            node({ id: 'g', type: 'group', visible: false }),
            node({ id: 'n1', parentId: 'g', quantizerHint: 'screentone' }),
        ]);
        // The child's own flag is on; the hidden ancestor suppresses it.
        expect(docUsesScreentone(doc)).toBe(false);
    });

    it('finds a visible screentone node beneath a visible group', () => {
        const doc = docWith([
            node({ id: 'g', type: 'group' }),
            node({ id: 'n1', parentId: 'g', quantizerHint: 'screentone' }),
        ]);
        expect(docUsesScreentone(doc)).toBe(true);
    });

    it('a hidden threshold node never matters either way', () => {
        expect(
            docUsesScreentone(
                docWith([node({ visible: false, quantizerHint: 'threshold' })]),
            ),
        ).toBe(false);
        // A hidden threshold node alongside a visible screentone still warns.
        expect(
            docUsesScreentone(
                docWith([
                    node({ id: 'hidden', visible: false, quantizerHint: 'threshold' }),
                    node({ id: 'n1', quantizerHint: 'screentone' }),
                ]),
            ),
        ).toBe(true);
    });
});

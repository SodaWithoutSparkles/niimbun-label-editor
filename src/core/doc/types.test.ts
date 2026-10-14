import { describe, expect, it } from 'vitest';
import type { LabelDoc } from './types';
import { isLabelDoc } from './validate';

/**
 * Compile-time drift guard: if `types.ts` and `validate.ts` diverge, the
 * `satisfies LabelDoc` assertions below stop compiling (tests are typechecked).
 */
const sampleDoc = (): LabelDoc => ({
    version: 1,
    meta: { id: 'doc-1', name: 'Sample', createdAt: 1_700_000_000, updatedAt: 1_700_000_100 },
    label: {
        backingW: 2500,
        backingH: 7800,
        dpi: 300,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 2500, h: 7800 }],
        guides: [],
        printDirection: 'top',
    },
    nodes: [
        {
            id: 'n1',
            parentId: null,
            type: 'text',
            name: 'greeting',
            visible: true,
            locked: false,
            transform: { x: 10, y: 20, rotDeg: 0, scaleX: 1, scaleY: 1 },
            text: { kind: 'static', value: 'hi' },
            quantizerHint: 'floydSteinberg',
        },
    ],
    data: { sampleRowIndex: 0, globals: [] },
    resources: { fonts: [], images: [] },
});

describe('LabelDoc type contract', () => {
    it('a hand-authored document satisfies LabelDoc', () => {
        const doc = sampleDoc() satisfies LabelDoc;
        expect(doc.nodes[0]?.type).toBe('text');
    });

    it('validator output is assignable to the frozen LabelDoc type', () => {
        const result = isLabelDoc(JSON.parse(JSON.stringify(sampleDoc())));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const parsed: LabelDoc = result.doc satisfies LabelDoc;
        expect(parsed.version).toBe(1);
        expect(parsed.label.backingW).toBe(2500);
        expect(parsed.nodes[0]?.quantizerHint).toBe('floydSteinberg');
    });
});

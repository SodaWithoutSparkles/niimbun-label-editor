import { describe, expect, it } from 'vitest';
import { createLabelDoc } from '../core/doc/factory';
import type { FontRef, GroupNode, Node, TextNode } from '../core/doc/types';
import { buildFontWarnings, buildPreviewWarnings, type PreviewWarningInputs } from './previewWarnings';

/**
 * `buildPreviewWarnings` / `buildFontWarnings` (P6): the pure aggregations
 * extracted from `PreviewStage`. Covers the entry ids/kinds/labels, the
 * jumpable/non-jumpable split, effective-visibility exclusion (including nodes
 * inside a hidden group) and the human-name fallback — the wiring that
 * previously only ran inside the Konva component.
 */

const node = (over: Partial<TextNode> & { id: string }): TextNode => ({
    parentId: null,
    type: 'text',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    text: { kind: 'static', value: 'hi' },
    ...over,
    id: over.id,
});

const group = (over: Partial<GroupNode> & { id: string }): GroupNode => ({
    parentId: null,
    type: 'group',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    ...over,
    id: over.id,
});

const fontRef = (over: Partial<FontRef> & { fontId: string }): FontRef => ({
    familyName: 'Inter',
    name: 'Inter',
    source: { kind: 'system', descriptor: 'Inter' },
    ...over,
    fontId: over.fontId,
});

const docWith = (nodes: Node[]) =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });

const inputs = (over: Partial<PreviewWarningInputs> = {}): PreviewWarningInputs => ({
    assetWarnings: new Map(),
    assetLabels: new Map(),
    keepOutIds: [],
    globalWarnings: [],
    templateErrors: undefined,
    blocked: false,
    needsApproval: false,
    sampleRowError: null,
    ...over,
});

describe('buildPreviewWarnings — entries', () => {
    it('maps asset warnings to jumpable entries using the asset label', () => {
        const doc = docWith([node({ id: 'n1' })]);

        const entries = buildPreviewWarnings(
            doc,
            inputs({
                assetWarnings: new Map([['n1', 'missing']]),
                assetLabels: new Map([['n1', 'Logo']]),
            }),
        );

        expect(entries).toEqual([
            { id: 'asset:n1', kind: 'asset', nodeId: 'n1', assetWarning: 'missing', label: 'Logo' },
        ]);
    });

    it('falls back to the node id when no asset label or node name exists', () => {
        const doc = docWith([node({ id: 'n1' })]);

        const entries = buildPreviewWarnings(doc, inputs({ assetWarnings: new Map([['n1', 'invalid']]) }));

        expect(entries[0]).toMatchObject({ id: 'asset:n1', label: 'n1', assetWarning: 'invalid' });
    });

    it('labels keep-out entries with the node name, falling back to the id', () => {
        const doc = docWith([node({ id: 'named', name: 'Title' }), node({ id: 'unnamed' })]);

        const entries = buildPreviewWarnings(doc, inputs({ keepOutIds: ['named', 'unnamed'] }));

        expect(entries).toEqual([
            { id: 'keep-out:named', kind: 'keep-out', nodeId: 'named', label: 'Title' },
            { id: 'keep-out:unnamed', kind: 'keep-out', nodeId: 'unnamed', label: 'unnamed' },
        ]);
    });

    it('emits document-level entries without a node id (non-jumpable)', () => {
        const doc = docWith([]);

        const entries = buildPreviewWarnings(
            doc,
            inputs({
                globalWarnings: [{ name: 'user', kind: 'timeout', message: 'timed out', url: 'https://example.com' }],
                blocked: true,
                needsApproval: true,
                sampleRowError: 'boom',
            }),
        );

        expect(entries).toEqual([
            { id: 'global:user:timeout', kind: 'global', name: 'user', warningKind: 'timeout' },
            { id: 'template:blocked', kind: 'template-blocked' },
            { id: 'template:approval', kind: 'template-approval' },
            { id: 'sample-row:error', kind: 'sample-row-error', message: 'boom' },
        ]);
        expect(entries.every((entry) => entry.nodeId === undefined)).toBe(true);
    });

    it('keeps template errors jumpable and names the failing node', () => {
        const doc = docWith([node({ id: 'n9', name: 'Price' })]);

        const entries = buildPreviewWarnings(
            doc,
            inputs({ templateErrors: new Map([['n9', 'ReferenceError: x is not defined']]) }),
        );

        expect(entries).toEqual([
            {
                id: 'template:n9',
                kind: 'template-error',
                nodeId: 'n9',
                label: 'Price',
                message: 'ReferenceError: x is not defined',
            },
        ]);
    });

    it('preserves the producer order (assets, keep-out, globals, template errors, flags)', () => {
        const doc = docWith([node({ id: 'n1', name: 'One' })]);

        const entries = buildPreviewWarnings(
            doc,
            inputs({
                assetWarnings: new Map([['n1', 'too-small']]),
                assetLabels: new Map([['n1', 'One']]),
                keepOutIds: ['n1'],
                globalWarnings: [{ name: 'g', kind: 'fetch', message: 'failed', url: 'https://example.com' }],
                blocked: true,
            }),
        );

        expect(entries.map((entry) => entry.id)).toEqual([
            'asset:n1',
            'keep-out:n1',
            'global:g:fetch',
            'template:blocked',
        ]);
    });
});

describe('buildPreviewWarnings — hidden nodes', () => {
    it('excludes keep-out entries for hidden nodes', () => {
        const doc = docWith([
            node({ id: 'shown', name: 'Shown' }),
            node({ id: 'hidden', name: 'Hidden', visible: false }),
        ]);

        const entries = buildPreviewWarnings(doc, inputs({ keepOutIds: ['shown', 'hidden'] }));

        expect(entries.map((entry) => entry.id)).toEqual(['keep-out:shown']);
    });

    it('excludes a node inside a hidden group but keeps a visible one', () => {
        const doc = docWith([
            group({ id: 'hiddenGroup', visible: false }),
            node({ id: 'insideHidden', parentId: 'hiddenGroup', name: 'Inside Hidden' }),
            group({ id: 'shownGroup' }),
            node({ id: 'insideShown', parentId: 'shownGroup', name: 'Inside Shown' }),
        ]);

        const entries = buildPreviewWarnings(doc, inputs({ keepOutIds: ['insideHidden', 'insideShown'] }));

        expect(entries).toEqual([
            { id: 'keep-out:insideShown', kind: 'keep-out', nodeId: 'insideShown', label: 'Inside Shown' },
        ]);
    });
});

describe('buildFontWarnings', () => {
    it('flags a text node whose font is absent from the resource set', () => {
        const doc = docWith([node({ id: 't1', fontId: 'f-unknown' })]);

        const entries = buildFontWarnings(doc, new Map());

        expect(entries).toEqual([
            { id: 'font:t1', kind: 'font-missing', nodeId: 't1', label: 'f-unknown' },
        ]);
    });

    it('flags a text node whose font badge is missing, using the font name', () => {
        const doc = docWith([node({ id: 't1', fontId: 'f1' })]);
        doc.resources.fonts = [fontRef({ fontId: 'f1', name: 'Inter' })];

        const entries = buildFontWarnings(doc, new Map([['f1', 'missing']]));

        expect(entries).toEqual([
            { id: 'font:t1', kind: 'font-missing', nodeId: 't1', label: 'Inter' },
        ]);
    });

    it('yields nothing for a resolvable font with a non-missing badge', () => {
        const doc = docWith([node({ id: 't1', fontId: 'f1' })]);
        doc.resources.fonts = [fontRef({ fontId: 'f1', name: 'Inter' })];

        expect(buildFontWarnings(doc, new Map([['f1', 'system']]))).toEqual([]);
        expect(buildFontWarnings(doc, new Map([['f1', 'imported']]))).toEqual([]);
    });

    it('skips non-text nodes and text nodes without a fontId', () => {
        const doc = docWith([node({ id: 't1' }), group({ id: 'g' })]);

        expect(buildFontWarnings(doc, new Map([['f1', 'missing']]))).toEqual([]);
    });
});

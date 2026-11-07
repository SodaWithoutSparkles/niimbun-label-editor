import { describe, expect, it } from 'vitest';
import { createLabelDoc } from '../core/doc/factory';
import type { ContentSource, LabelDoc, Node } from '../core/doc/types';
import { presetFieldNames, presetFields } from './presetFields';

/**
 * P5 — field discovery for the fill dialog. Only distinct, non-empty `field`
 * bindings count, in node order; the other source kinds are ignored.
 */

const base = (id: string, type: Node['type']) => ({
    id,
    parentId: null,
    type,
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
});

const textNode = (id: string, source: ContentSource): Node => ({
    ...base(id, 'text'),
    type: 'text',
    text: source,
});

const qrNode = (id: string, source: ContentSource): Node => ({
    ...base(id, 'qr'),
    type: 'qr',
    data: source,
});

const barcodeNode = (id: string, source: ContentSource): Node => ({
    ...base(id, 'barcode'),
    type: 'barcode',
    data: source,
});

const codeNode = (id: string, source: ContentSource): Node => ({
    ...base(id, 'code'),
    type: 'code',
    data: source,
    format: 'datamatrix',
});

const field = (name: string, fallback = ''): ContentSource => ({
    kind: 'field',
    name,
    fallback,
});

const docOf = (nodes: Node[]): LabelDoc =>
    createLabelDoc({ id: 'preset-1', name: 'Preset', kind: 'preset', nodes, now: 1_000_000 });

describe('presetFields', () => {
    it('returns distinct field names in node order across text/qr/barcode/code', () => {
        const doc = docOf([
            textNode('a', field('price', '0.00')),
            qrNode('b', field('sku', 'SKU-000')),
            barcodeNode('c', field('price', '9.99')),
            codeNode('d', field('batch')),
        ]);

        expect(presetFieldNames(doc)).toEqual(['price', 'sku', 'batch']);
    });

    it('keeps the first binding fallback for a repeated name', () => {
        const doc = docOf([
            textNode('a', field('price', '0.00')),
            qrNode('b', field('price', 'ignored')),
        ]);

        expect(presetFields(doc)).toEqual([{ name: 'price', fallback: '0.00' }]);
    });

    it('ignores empty names (the half-authored state)', () => {
        const doc = docOf([
            textNode('a', field('', 'placeholder')),
            textNode('b', field('sku', 'SKU')),
        ]);

        expect(presetFieldNames(doc)).toEqual(['sku']);
    });

    it('ignores static, csv and template sources', () => {
        const doc = docOf([
            textNode('a', { kind: 'static', value: 'plain' }),
            textNode('b', { kind: 'csv', column: 'name', fallback: 'FB' }),
            textNode('c', { kind: 'template', code: 'return 1', fallback: 'FB' }),
        ]);

        expect(presetFields(doc)).toEqual([]);
    });

    it('returns an empty list for a document with no nodes', () => {
        expect(presetFieldNames(docOf([]))).toEqual([]);
    });
});

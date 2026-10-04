import { describe, expect, it } from 'vitest';
import type { Node, NodeType } from '../core/doc/types';
import {
    BARCODE_FIELDS,
    IMAGE_FIELDS,
    QR_FIELDS,
    QUANTIZER_HINT_OPTIONS,
    RESERVED_FIELDS,
    SHAPE_FIELDS,
    TEXT_FIELDS,
    TRANSFORM_FIELDS,
    UNIVERSAL_FIELDS,
    bulkFieldModel,
    fieldsForNodeType,
    typeFields,
} from './inspectorModel';

const node = (id: string, type: NodeType): Node => {
    const shared = {
        id,
        parentId: null,
        type,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    };
    switch (type) {
        case 'group':
            return { ...shared, type: 'group' } as Node;
        case 'text':
            return { ...shared, type: 'text', text: { kind: 'static', value: id } } as Node;
        case 'shape':
            return { ...shared, type: 'shape', shape: 'rectangle' } as Node;
        case 'image':
            return { ...shared, type: 'image', imageId: id } as Node;
        case 'qr':
            return { ...shared, type: 'qr', data: { kind: 'static', value: id } } as Node;
        case 'barcode':
            return { ...shared, type: 'barcode', data: { kind: 'static', value: id } } as Node;
    }
};

const keys = (fields: readonly { key: string }[]): string[] => fields.map((f) => f.key);

describe('inspectorModel — field descriptors', () => {
    it('exposes the transform fields expected by the Object tab', () => {
        expect(keys(TRANSFORM_FIELDS)).toEqual(['x', 'y', 'sizeW', 'sizeH', 'rotDeg', 'scaleX', 'scaleY']);
        expect(TRANSFORM_FIELDS.every((f) => f.wired)).toBe(true);
    });

    it('honestly marks fields the renderer cannot act on as unwired', () => {
        // The resolver ignores these props, so advertising them as wired would
        // let a user edit a field nothing reads (should-fix #13).
        const unactionable = ['fontWeight', 'letterSpacing', 'direction', 'fill', 'stroke', 'strokeWidth', 'cornerRadius'];
        for (const key of unactionable) {
            const field = [...TEXT_FIELDS, ...SHAPE_FIELDS].find((f) => f.key === key);
            expect(field?.wired, key).toBe(false);
        }
        // The ones the renderer *does* read stay wired.
        for (const key of ['fontFamily', 'fontSize', 'fontStyle', 'align', 'closed', 'shape']) {
            const field = [...TEXT_FIELDS, ...SHAPE_FIELDS].find((f) => f.key === key);
            expect(field?.wired, key).toBe(true);
        }
    });

    it('tags every unwired field with the engine that owns it', () => {
        for (const field of IMAGE_FIELDS) expect(field.reason).toBe('image');
        for (const field of QR_FIELDS) expect(field.reason).toBe('qr');
        for (const field of BARCODE_FIELDS) expect(field.reason).toBe('barcode');
        for (const field of RESERVED_FIELDS.filter((f) => !f.wired)) {
            expect(['trust', 'content']).toContain(field.reason);
        }
        // Trust is P6; the per-object quantizer policy is now wired (P4).
        expect(RESERVED_FIELDS.find((f) => f.key === 'templateTrust')?.reason).toBe('trust');
    });

    it('wires quantizerHint as a select over the quantizer registry', () => {
        const field = RESERVED_FIELDS.find((f) => f.key === 'quantizerHint');
        expect(field?.wired).toBe(true);
        expect(field?.kind).toBe('select');
        // Explicit default (empty) plus all four quantizer ids, registry order.
        expect(field?.options).toEqual(QUANTIZER_HINT_OPTIONS);
        expect(field?.options).toContain('');
        for (const id of ['threshold', 'floydSteinberg', 'stucki', 'atkinson']) {
            expect(field?.options).toContain(id);
        }
    });

    it('typeFields returns the type-specific props per node type', () => {
        expect(typeFields('text')).toEqual(TEXT_FIELDS);
        expect(typeFields('shape')).toEqual(SHAPE_FIELDS);
        expect(typeFields('image')).toEqual(IMAGE_FIELDS);
        expect(typeFields('qr')).toEqual(QR_FIELDS);
        expect(typeFields('barcode')).toEqual(BARCODE_FIELDS);
        expect(typeFields('group')).toEqual([]);
    });

    it('marks unwired engine fields (image / qr / barcode) as disabled stubs', () => {
        for (const field of [...IMAGE_FIELDS, ...QR_FIELDS, ...BARCODE_FIELDS]) {
            expect(field.wired).toBe(false);
        }
    });

    it('keeps contentSource and templateTrust as unwired descriptors', () => {
        expect(keys(RESERVED_FIELDS)).toEqual(['contentSource', 'quantizerHint', 'templateTrust']);
        for (const key of ['contentSource', 'templateTrust']) {
            expect(RESERVED_FIELDS.find((f) => f.key === key)?.wired).toBe(false);
        }
        expect(RESERVED_FIELDS.find((f) => f.key === 'quantizerHint')?.wired).toBe(true);
    });
});

describe('inspectorModel — single-selection field set', () => {
    it('combines transform + type + universal + reserved, with no duplicate keys', () => {
        const fields = fieldsForNodeType('text');
        const fieldKeys = keys(fields);
        expect(new Set(fieldKeys).size).toBe(fieldKeys.length);
        expect(fieldKeys).toContain('x');
        expect(fieldKeys).toContain('fontFamily');
        expect(fieldKeys).toContain('text');
        expect(fieldKeys).toContain('contentSource');
        // The layers panel owns visible/locked (ui-spec §7), so the Object tab
        // must not advertise them (must-fix #9).
        expect(fieldKeys).not.toContain('visible');
        expect(fieldKeys).not.toContain('locked');
        // `align` appears in both text and universal sets but only once.
        expect(fieldKeys.filter((k) => k === 'align')).toHaveLength(1);
    });

    it('omits reserved fields for a group', () => {
        expect(keys(fieldsForNodeType('group'))).not.toContain('contentSource');
    });
});

describe('inspectorModel — bulk mode', () => {
    it('empty selection is single with no fields', () => {
        const model = bulkFieldModel([]);
        expect(model.mode).toBe('single');
        expect(model.fields).toEqual([]);
        expect(model.types).toEqual([]);
    });

    it('single selection is single with the full type field set', () => {
        const model = bulkFieldModel([node('a', 'text')]);
        expect(model.mode).toBe('single');
        expect(keys(model.fields)).toContain('fontFamily');
    });

    it('same-type multi-selection shows transform + that type shared props + universal', () => {
        const model = bulkFieldModel([node('a', 'text'), node('b', 'text')]);
        expect(model.mode).toBe('same-type');
        expect(model.types).toEqual(['text']);
        const fieldKeys = keys(model.fields);
        expect(fieldKeys).toContain('x');
        expect(fieldKeys).toContain('fontFamily');
        expect(fieldKeys).toContain('align');
        // visible/locked belong to the layers panel, not the Object tab.
        expect(fieldKeys).not.toContain('visible');
        expect(fieldKeys).not.toContain('locked');
        // reserved stubs are not part of bulk same-type mode
        expect(fieldKeys).not.toContain('contentSource');
    });

    it('mixed selection shows only universal props', () => {
        const model = bulkFieldModel([node('a', 'text'), node('b', 'shape')]);
        expect(model.mode).toBe('mixed');
        expect(model.types).toEqual(['text', 'shape']);
        expect(model.fields).toEqual([...UNIVERSAL_FIELDS]);
        expect(keys(model.fields)).toEqual(['align']);
    });

    it('three mixed types also collapse to universal props', () => {
        const model = bulkFieldModel([node('a', 'text'), node('b', 'shape'), node('c', 'qr')]);
        expect(model.mode).toBe('mixed');
        expect(keys(model.fields)).toEqual(['align']);
    });

    it('reports duplicate-type order in first-seen order', () => {
        const model = bulkFieldModel([node('a', 'qr'), node('b', 'text')]);
        expect(model.types).toEqual(['qr', 'text']);
    });
});

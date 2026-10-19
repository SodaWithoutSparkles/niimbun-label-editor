import { describe, expect, it } from 'vitest';
import type { Node, NodeType } from '../core/doc/types';
import { BARCODE_SYMBOLOGIES, CODE_FORMATS, IMAGE_FITS, QR_ERROR_CORRECTIONS } from '../core/doc/objects';
import {
    BARCODE_FIELDS,
    CODE_FIELDS,
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
        case 'code':
            return {
                ...shared,
                type: 'code',
                format: 'datamatrix',
                data: { kind: 'static', value: id },
            } as Node;
    }
};

const keys = (fields: readonly { key: string }[]): string[] => fields.map((f) => f.key);

describe('inspectorModel — field descriptors', () => {
    it('exposes the transform fields expected by the Object tab', () => {
        expect(keys(TRANSFORM_FIELDS)).toEqual(['x', 'y', 'sizeW', 'sizeH', 'rotDeg', 'scaleX', 'scaleY']);
        expect(TRANSFORM_FIELDS.every((f) => f.wired)).toBe(true);
    });

    it('honestly marks fields the renderer cannot act on as unwired', () => {
        // The resolver ignores these text props, so advertising them as wired
        // would let a user edit a field nothing reads (should-fix #13). Their
        // reason is `style`, not the misleading CSV/template `content` message.
        const unactionable = ['letterSpacing', 'direction'];
        for (const key of unactionable) {
            const field = [...TEXT_FIELDS, ...SHAPE_FIELDS].find((f) => f.key === key);
            expect(field?.wired, key).toBe(false);
            expect(field?.reason, key).toBe('style');
        }
        // The ones the renderer *does* read stay wired.
        for (const key of ['fontFamily', 'fontSize', 'closed', 'shape']) {
            const field = [...TEXT_FIELDS, ...SHAPE_FIELDS].find((f) => f.key === key);
            expect(field?.wired, key).toBe(true);
        }
    });

    it('drops the fields now edited inline or via toolbar icons', () => {
        // Text content is edited WYSIWYG in place; bold/italic and text-align
        // are toolbar toggles (ViewControls). None belong to the Object tab.
        const gone = ['text', 'fontWeight', 'fontStyle', 'align'];
        for (const key of gone) {
            expect(keys(TEXT_FIELDS), key).not.toContain(key);
        }
    });

    it('wires the real static shape style fields (#8)', () => {
        // #8: the resolver + both renderers now honour these, so they are wired.
        for (const key of ['fill', 'stroke', 'strokeWidth', 'cornerRadius']) {
            const field = SHAPE_FIELDS.find((f) => f.key === key);
            expect(field?.wired, key).toBe(true);
        }
        expect(SHAPE_FIELDS.find((f) => f.key === 'fill')?.kind).toBe('color');
        expect(SHAPE_FIELDS.find((f) => f.key === 'stroke')?.kind).toBe('color');
        expect(SHAPE_FIELDS.find((f) => f.key === 'strokeWidth')?.kind).toBe('number');
        expect(SHAPE_FIELDS.find((f) => f.key === 'cornerRadius')?.kind).toBe('number');
        // `points` stays a stub, but with the honest `style` reason — not the
        // misleading CSV `content` message.
        const points = SHAPE_FIELDS.find((f) => f.key === 'points');
        expect(points?.wired).toBe(false);
        expect(points?.reason).toBe('style');
    });

    it('tags every unwired field with the engine that owns it', () => {
        for (const field of IMAGE_FIELDS.filter((f) => !f.wired)) expect(field.reason).toBe('image');
        // QR / barcode carried a disabled `size` stub; it is gone, so no field
        // of either type is unwired any more.
        expect(QR_FIELDS.every((f) => f.wired)).toBe(true);
        expect(BARCODE_FIELDS.every((f) => f.wired)).toBe(true);
        for (const field of RESERVED_FIELDS.filter((f) => !f.wired)) {
            expect(['trust', 'content']).toContain(field.reason);
        }
        // P6: contentSource and templateTrust are wired now, so no reserved
        // field is a disabled stub.
        expect(RESERVED_FIELDS.every((f) => f.wired)).toBe(true);
    });

    it('no longer exposes the useless `size` stub on any type', () => {
        // Size is edited through the numeric sizeW/sizeH transform fields, so the
        // aggregate `{w,h}` stub was dropped from every type's field list.
        for (const fields of [TEXT_FIELDS, SHAPE_FIELDS, QR_FIELDS, BARCODE_FIELDS, IMAGE_FIELDS]) {
            expect(keys(fields)).not.toContain('size');
        }
    });

    it('wires per-node quantizer params as numeric fields', () => {
        expect(keys(RESERVED_FIELDS)).toEqual([
            'contentSource', 'quantizerHint', 'quantizerThreshold', 'quantizerStrength',
            'quantizerSerpentine', 'quantizerGamma', 'templateTrust',
        ]);
        expect(RESERVED_FIELDS.find((field) => field.key === 'quantizerThreshold')).toMatchObject({
            kind: 'number',
            wired: true,
        });
        expect(RESERVED_FIELDS.find((field) => field.key === 'quantizerStrength')).toMatchObject({
            kind: 'number',
            wired: true,
        });
    });

    it('wires per-node serpentine as a select over the auto/on/off sentinels', () => {
        const field = RESERVED_FIELDS.find((f) => f.key === 'quantizerSerpentine');
        expect(field).toMatchObject({ kind: 'select', wired: true });
        // `''` (auto) + on/off, never a plain boolean field.
        expect(field?.options).toEqual(['', 'on', 'off']);
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
        expect(typeFields('code')).toEqual(CODE_FIELDS);
        expect(typeFields('group')).toEqual([]);
    });

    it('wires the P5 image / qr / barcode options (no size stub)', () => {
        const image = Object.fromEntries(IMAGE_FIELDS.map((f) => [f.key, f]));
        expect(image.imageId?.wired).toBe(true);
        expect(image.imageId?.kind).toBe('imageRef');
        expect(image.fit?.wired).toBe(true);
        expect(image.fit?.options).toEqual(IMAGE_FITS);
        // The resolution cap is derived; there is no editable field.
        expect(image.resolution).toBeUndefined();

        const qr = Object.fromEntries(QR_FIELDS.map((f) => [f.key, f]));
        expect(qr.data?.wired).toBe(true);
        expect(qr.data?.kind).toBe('dataContent');
        expect(qr.errorCorrection?.options).toEqual(QR_ERROR_CORRECTIONS);
        // Symbol background + quiet zone (P2) are wired.
        expect(qr.fill?.wired).toBe(true);
        expect(qr.fill?.kind).toBe('color');
        expect(qr.quietZone?.wired).toBe(true);
        expect(qr.quietZone?.kind).toBe('number');
        // The useless `size` stub is gone (size is edited via sizeW/sizeH).
        expect(qr.size).toBeUndefined();

        const barcode = Object.fromEntries(BARCODE_FIELDS.map((f) => [f.key, f]));
        expect(barcode.data?.wired).toBe(true);
        expect(barcode.symbology?.options).toEqual(BARCODE_SYMBOLOGIES);
        expect(barcode.fill?.wired).toBe(true);
        expect(barcode.fill?.kind).toBe('color');
        expect(barcode.quietZone?.wired).toBe(true);
        expect(barcode.quietZone?.kind).toBe('number');
        expect(barcode.size).toBeUndefined();
    });

    it('wires the P11 code options (format select over CODE_FORMATS)', () => {
        const code = Object.fromEntries(CODE_FIELDS.map((f) => [f.key, f]));
        expect(code.data?.wired).toBe(true);
        expect(code.data?.kind).toBe('dataContent');
        expect(code.format?.wired).toBe(true);
        expect(code.format?.kind).toBe('select');
        expect(code.format?.options).toEqual(CODE_FORMATS);
        expect(code.fill?.wired).toBe(true);
        expect(code.fill?.kind).toBe('color');
        expect(code.quietZone?.wired).toBe(true);
        expect(code.quietZone?.kind).toBe('number');
        // The useless `size` stub is gone (size is edited via sizeW/sizeH).
        expect(code.size).toBeUndefined();
        // The Object tab resolves the `format` label lazily; it must be present.
        expect(keys(fieldsForNodeType('code'))).toContain('format');
    });

    it('offers a font-resource select and a curated system-font picker', () => {
        const fontId = TEXT_FIELDS.find((f) => f.key === 'fontId');
        expect(fontId?.wired).toBe(true);
        expect(fontId?.kind).toBe('fontRef');
        const family = TEXT_FIELDS.find((f) => f.key === 'fontFamily');
        expect(family?.wired).toBe(true);
        expect(family?.kind).toBe('select');
        expect(family?.options).toContain('sans-serif');
    });

    it('wires text wrap as a select over the four modes (P5)', () => {
        const field = TEXT_FIELDS.find((f) => f.key === 'wrap');
        expect(field?.wired).toBe(true);
        expect(field?.kind).toBe('select');
        expect(field?.options).toEqual(['word', 'char', 'clip', 'shrink']);
        // The Object tab resolves its label lazily; a missing key would render raw.
        expect(keys(typeFields('text'))).toContain('wrap');
    });

    it('wires contentSource and templateTrust (P6)', () => {
        expect(keys(RESERVED_FIELDS)).toEqual(['contentSource', 'quantizerHint', 'quantizerThreshold', 'quantizerStrength', 'quantizerSerpentine', 'quantizerGamma', 'templateTrust']);
        const contentSource = RESERVED_FIELDS.find((f) => f.key === 'contentSource');
        expect(contentSource?.wired).toBe(true);
        expect(contentSource?.kind).toBe('contentSource');
        expect(contentSource?.options).toEqual(['static', 'csv', 'template']);
        const trust = RESERVED_FIELDS.find((f) => f.key === 'templateTrust');
        expect(trust?.wired).toBe(true);
        expect(trust?.kind).toBe('templateTrust');
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
        expect(fieldKeys).toContain('contentSource');
        // The layers panel owns visible/locked (ui-spec §7), so the Object tab
        // must not advertise them (must-fix #9).
        expect(fieldKeys).not.toContain('visible');
        expect(fieldKeys).not.toContain('locked');
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
        // `UNIVERSAL_FIELDS` is now empty: mixed selections expose no field.
        expect(model.fields).toEqual([...UNIVERSAL_FIELDS]);
        expect(keys(model.fields)).toEqual([]);
    });

    it('three mixed types also collapse to universal props', () => {
        const model = bulkFieldModel([node('a', 'text'), node('b', 'shape'), node('c', 'qr')]);
        expect(model.mode).toBe('mixed');
        expect(keys(model.fields)).toEqual([]);
    });

    it('reports duplicate-type order in first-seen order', () => {
        const model = bulkFieldModel([node('a', 'qr'), node('b', 'text')]);
        expect(model.types).toEqual(['qr', 'text']);
    });
});

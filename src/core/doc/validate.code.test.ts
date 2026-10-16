import { describe, expect, it } from 'vitest';
import { CODE_FORMATS, DEFAULT_CODE_FORMAT } from './objects';
import { isLabelDoc, isNode } from './validate';

/**
 * P11 W5: `code` node validation. `format` is **required** on `CodeNode`, so —
 * unlike QR's optional `errorCorrection`, which drops to absent — an absent or
 * invalid `format` is coerced to `DEFAULT_CODE_FORMAT` at validate time. `fill`
 * and `quietZone` share the P2 symbol rules (invalid colour dropped, quiet zone
 * clamped to `[0, 64]`, an explicit `0` preserved).
 *
 * Harness mirrors `validate.test.ts`.
 */

const validRaw = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    version: 1,
    meta: { id: 'doc-1', name: 'Label', createdAt: 1_700_000_000, updatedAt: 1_700_000_000 },
    label: { backingW: 2500, backingH: 7800, dpi: 300, regions: [], printDirection: 'top' },
    nodes: [],
    data: { sampleRowIndex: 0, globals: [] },
    resources: { fonts: [], images: [] },
    ...overrides,
});

const baseNode = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'node-1',
    parentId: null,
    type: 'shape',
    visible: true,
    locked: false,
    transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    shape: 'rectangle',
    ...over,
});

const codeNode = (over: Record<string, unknown> = {}, repairs?: string[]) =>
    isNode(
        baseNode({
            id: 'c',
            type: 'code',
            shape: undefined,
            data: { kind: 'static', value: 'LABEL-EDITOR-2D' },
            ...over,
        }),
        repairs,
    );

const formatOf = (n: ReturnType<typeof isNode>): string | undefined =>
    n?.type === 'code' ? n.format : undefined;
const quietZoneOf = (n: ReturnType<typeof isNode>): number | undefined =>
    n?.type === 'code' ? n.quietZone : undefined;

describe('isNode — code format (P11)', () => {
    it('round-trips an explicit format, fill and quietZone', () => {
        const node = codeNode({ format: 'pdf417', fill: '#123456', quietZone: 6 });
        expect(formatOf(node)).toBe('pdf417');
        expect(node?.type === 'code' && node.fill).toBe('#123456');
        expect(quietZoneOf(node)).toBe(6);
    });

    it('round-trips every CODE_FORMATS value', () => {
        for (const format of CODE_FORMATS) {
            expect(formatOf(codeNode({ format })), format).toBe(format);
        }
    });

    it('coerces an invalid/absent format to DEFAULT_CODE_FORMAT (never fails the node)', () => {
        expect(DEFAULT_CODE_FORMAT).toBe('datamatrix');

        const repairs: string[] = [];
        const unknown = codeNode({ format: 'nope' }, repairs);
        expect(unknown?.type).toBe('code');
        expect(formatOf(unknown)).toBe(DEFAULT_CODE_FORMAT);
        expect(repairs.join(' ')).toContain('node.code.format: unknown format dropped');

        // A present-but-wrong-type value is treated the same way.
        const wrongType = codeNode({ format: 7 });
        expect(formatOf(wrongType)).toBe(DEFAULT_CODE_FORMAT);

        // Absent is coerced silently (no repair — it is the documented default).
        const absentRepairs: string[] = [];
        const absent = codeNode({ format: undefined }, absentRepairs);
        expect(formatOf(absent)).toBe(DEFAULT_CODE_FORMAT);
        expect(absentRepairs).toEqual([]);
    });
});

describe('isNode — code fill & quietZone (P11)', () => {
    it('drops an invalid fill with a repair', () => {
        const repairs: string[] = [];
        const node = codeNode({ format: 'datamatrix', fill: 'red' }, repairs);
        expect(node?.type === 'code' && node.fill).toBeUndefined();
        expect(repairs.join(' ')).toContain('node.fill: invalid colour dropped');
    });

    it('clamps quietZone to [0,64], rounds finite values, and drops invalid ones', () => {
        // Negative clamps to 0 with a visible repair.
        const negRepairs: string[] = [];
        const negative = codeNode({ format: 'datamatrix', quietZone: -3 }, negRepairs);
        expect(quietZoneOf(negative)).toBe(0);
        expect(negRepairs.join(' ')).toContain('node.quietZone: clamped to 0–64');

        // Above the cap clamps to 64.
        const highRepairs: string[] = [];
        const high = codeNode({ format: 'datamatrix', quietZone: 999 }, highRepairs);
        expect(quietZoneOf(high)).toBe(64);
        expect(highRepairs.join(' ')).toContain('node.quietZone: clamped to 0–64');

        // A finite float rounds with no repair.
        const roundRepairs: string[] = [];
        const rounded = codeNode({ format: 'datamatrix', quietZone: 6.4 }, roundRepairs);
        expect(quietZoneOf(rounded)).toBe(6);
        expect(roundRepairs).toEqual([]);

        // Non-number / NaN is dropped (absent ⇒ per-format default) with a repair.
        for (const bad of ['x', Number.NaN, null, {}]) {
            const repairs: string[] = [];
            const dropped = codeNode({ format: 'datamatrix', quietZone: bad }, repairs);
            expect(quietZoneOf(dropped), String(bad)).toBeUndefined();
            expect(repairs.join(' ')).toContain('node.quietZone: invalid value dropped');
        }

        // Absent stays absent, silently.
        const absent = codeNode({ format: 'datamatrix', quietZone: undefined });
        expect(quietZoneOf(absent)).toBeUndefined();
    });

    it('preserves an explicit quietZone 0 (not mistaken for absent)', () => {
        // 0 is a real override (strip the quiet zone); it must survive round-trip.
        const node = codeNode({ format: 'datamatrix', quietZone: 0 });
        expect(quietZoneOf(node)).toBe(0);
    });

    it('round-trips format/fill/quietZone through isLabelDoc (serialize → parse → serialize)', () => {
        const raw = validRaw({
            nodes: [
                baseNode({
                    id: 'c',
                    type: 'code',
                    shape: undefined,
                    data: { kind: 'static', value: 'LABEL-EDITOR-2D' },
                    format: 'hanxin',
                    fill: '#123456',
                    quietZone: 3,
                }),
            ],
        });
        const first = isLabelDoc(raw);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const code = first.doc.nodes[0];
        expect(code?.type === 'code' && code.format).toBe('hanxin');
        expect(code?.type === 'code' && code.fill).toBe('#123456');
        expect(code?.type === 'code' && code.quietZone).toBe(3);

        const second = isLabelDoc(JSON.parse(JSON.stringify(first.doc)));
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(JSON.stringify(second.doc)).toBe(JSON.stringify(first.doc));
    });
});

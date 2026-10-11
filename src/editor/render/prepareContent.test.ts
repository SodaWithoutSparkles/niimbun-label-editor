import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentSource, LabelDoc, Node } from '../../core/doc/types';
import { createLabelDoc } from '../../core/doc/factory';
import type { CsvRecord } from '../../data/csvRepo';
import type { TemplateContext, TemplateEngine } from '../../templates/engine';
import { DEFAULT_EMPTY_TEXT, resolve } from './resolve';
import { prepareResolvedContent } from './prepareContent';

const NOW_MS = 1_700_000_000_000;

const csv = (rows: string[][], columns: string[] = ['sku', 'name']): CsvRecord => ({
    id: 'csv-1',
    name: 'data.csv',
    columns,
    rows,
});

interface EngineCall {
    source: string;
    context: TemplateContext;
}

/** A `TemplateEngine` whose `evaluate` records every call and uses `impl`. */
const createFakeEngine = (impl: (source: string, ctx: TemplateContext) => unknown) => {
    const calls: EngineCall[] = [];
    const engine: TemplateEngine = {
        async evaluate(source, context) {
            calls.push({ source, context });
            return impl(source, context);
        },
    };
    return { engine, calls };
};

const leaf = (id: string, type: 'text' | 'qr' | 'barcode', source: ContentSource, parentId: string | null = null): Node =>
    ({
        id,
        parentId,
        type,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 100, h: 50 },
        ...(type === 'text' ? { text: source } : { data: source }),
    }) as Node;

const docWith = (nodes: Node[]): LabelDoc => createLabelDoc({ id: 'doc-1', now: 1_700_000_000, nodes });

const deepFreeze = <T>(value: T): T => {
    if (value !== null && typeof value === 'object') {
        for (const key of Object.keys(value)) {
            deepFreeze((value as Record<string, unknown>)[key]);
        }
        Object.freeze(value);
    }
    return value;
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('prepareResolvedContent — csv binding', () => {
    it('resolves a cell by column name', async () => {
        const doc = docWith([leaf('t1', 'text', { kind: 'csv', column: 'name', fallback: 'N/A' })]);
        const map = await prepareResolvedContent({ doc, csv: csv([['A1', 'Bolt']]), rowIndex: 0 });
        expect(map.get('t1')).toEqual({ text: 'Bolt', placeholder: false });
    });

    it('uses the fallback for an unknown column', async () => {
        const doc = docWith([leaf('t1', 'text', { kind: 'csv', column: 'missing', fallback: 'N/A' })]);
        const map = await prepareResolvedContent({ doc, csv: csv([['A1', 'Bolt']]), rowIndex: 0 });
        expect(map.get('t1')).toEqual({ text: 'N/A', placeholder: false });
    });

    it('uses the fallback when the row index is absent', async () => {
        const doc = docWith([leaf('t1', 'text', { kind: 'csv', column: 'sku', fallback: 'N/A' })]);
        const map = await prepareResolvedContent({ doc, csv: csv([['A1', 'Bolt']]), rowIndex: 9 });
        expect(map.get('t1')).toEqual({ text: 'N/A', placeholder: false });
    });

    it('uses the fallback for an empty cell, and the placeholder for an empty fallback', async () => {
        const doc = docWith([
            leaf('t1', 'text', { kind: 'csv', column: 'sku', fallback: 'N/A' }),
            leaf('t2', 'text', { kind: 'csv', column: 'sku', fallback: '' }),
        ]);
        const map = await prepareResolvedContent({ doc, csv: csv([['']]), rowIndex: 0 });
        expect(map.get('t1')).toEqual({ text: 'N/A', placeholder: false });
        expect(map.get('t2')).toEqual({ text: DEFAULT_EMPTY_TEXT, placeholder: true });
    });

    it('uses the fallback when no CSV is attached', async () => {
        const doc = docWith([leaf('t1', 'text', { kind: 'csv', column: 'sku', fallback: 'N/A' })]);
        const map = await prepareResolvedContent({ doc, csv: null, rowIndex: 0 });
        expect(map.get('t1')).toEqual({ text: 'N/A', placeholder: false });
    });

    it('binds the first column when column names are duplicated', async () => {
        const doc = docWith([leaf('t1', 'text', { kind: 'csv', column: 'sku', fallback: 'F' })]);
        const map = await prepareResolvedContent({
            doc,
            csv: csv([['first', 'last']], ['sku', 'sku']),
            rowIndex: 0,
        });
        expect(map.get('t1')).toEqual({ text: 'first', placeholder: false });
    });

    it('resolves qr and barcode leaves as well as text', async () => {
        const source: ContentSource = { kind: 'csv', column: 'sku', fallback: 'N/A' };
        const doc = docWith([leaf('q1', 'qr', source), leaf('b1', 'barcode', source)]);
        const map = await prepareResolvedContent({ doc, csv: csv([['A1', 'Bolt']]), rowIndex: 0 });
        expect(map.get('q1')).toEqual({ text: 'A1', placeholder: false });
        expect(map.get('b1')).toEqual({ text: 'A1', placeholder: false });
    });
});

describe('prepareResolvedContent — template binding', () => {
    it('evaluates via the injected engine with the plan context', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
        const { engine, calls } = createFakeEngine(() => 'hello');
        const doc = docWith([
            leaf('t1', 'text', { kind: 'template', code: 'return ctx.row.name', fallback: 'F' }),
        ]);
        const map = await prepareResolvedContent({
            doc,
            csv: csv([
                ['A1', 'Bolt'],
                ['A2', 'Nut'],
            ]),
            rowIndex: 0,
            engine,
            ctx: { label: { name: 'L' }, globals: { greet: 'hi' }, fmt: { locale: 'en-US' } },
        });

        expect(map.get('t1')).toEqual({ text: 'hello', placeholder: false });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.source).toBe('return ctx.row.name');
        expect(calls[0]!.context).toEqual({
            index: 0,
            total: 2,
            row: { sku: 'A1', name: 'Bolt' },
            rowCount: 2,
            now: NOW_MS,
            label: { name: 'L' },
            globals: { greet: 'hi' },
            fmt: { locale: 'en-US' },
            seeds: { docSeed: 'doc-1' },
        });
    });

    it('seeds ctx.seeds.docSeed from doc.meta.id', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
        const { engine, calls } = createFakeEngine(() => 'hello');
        const doc = docWith([leaf('t1', 'text', { kind: 'template', code: 'x', fallback: 'F' })]);
        doc.meta.id = 'doc-xyz';

        await prepareResolvedContent({ doc, csv: null, rowIndex: 0, engine });

        expect(calls[0]!.context.seeds).toEqual({ docSeed: 'doc-xyz' });
    });

    it('coerces primitive results and falls back on reject/empty/undefined', async () => {
        const cases: Array<{ impl: () => unknown; expected: { text: string; placeholder: boolean } }> = [
            { impl: () => 42, expected: { text: '42', placeholder: false } },
            { impl: () => false, expected: { text: 'false', placeholder: false } },
            { impl: () => undefined, expected: { text: 'F', placeholder: false } },
            { impl: () => '', expected: { text: 'F', placeholder: false } },
            { impl: () => ({ nope: true }), expected: { text: 'F', placeholder: false } },
            {
                impl: () => {
                    throw new Error('boom');
                },
                expected: { text: 'F', placeholder: false },
            },
        ];

        for (const testCase of cases) {
            const { engine } = createFakeEngine(testCase.impl);
            const doc = docWith([leaf('t1', 'text', { kind: 'template', code: 'x', fallback: 'F' })]);
            const map = await prepareResolvedContent({ doc, csv: null, rowIndex: 0, engine });
            expect(map.get('t1')).toEqual(testCase.expected);
        }
    });

    it('uses the placeholder when the template fails and the fallback is empty', async () => {
        const { engine } = createFakeEngine(() => undefined);
        const doc = docWith([leaf('t1', 'text', { kind: 'template', code: 'x', fallback: '' })]);
        const map = await prepareResolvedContent({ doc, csv: null, rowIndex: 0, engine });
        expect(map.get('t1')).toEqual({ text: DEFAULT_EMPTY_TEXT, placeholder: true });
    });

    it('exposes __proto__/constructor columns to templates as ordinary cells', async () => {
        const { engine } = createFakeEngine((_source, ctx) => `${ctx.row['__proto__']}${ctx.row['constructor']}`);
        const doc = docWith([leaf('t1', 'text', { kind: 'template', code: 'x', fallback: 'F' })]);
        const map = await prepareResolvedContent({
            doc,
            csv: csv([['p', 'c']], ['__proto__', 'constructor']),
            rowIndex: 0,
            engine,
        });
        expect(map.get('t1')).toEqual({ text: 'pc', placeholder: false });
    });

    it('degrades to the fallback when no engine is injected', async () => {
        const doc = docWith([leaf('t1', 'text', { kind: 'template', code: 'x', fallback: 'F' })]);
        const map = await prepareResolvedContent({ doc, csv: null, rowIndex: 0 });
        expect(map.get('t1')).toEqual({ text: 'F', placeholder: false });
    });
});

describe('prepareResolvedContent — invariants', () => {
    it('leaves static sources out of the map', async () => {
        const doc = docWith([
            leaf('s1', 'text', { kind: 'static', value: 'hi' }),
            leaf('s2', 'qr', { kind: 'static', value: 'q' }),
        ]);
        const map = await prepareResolvedContent({ doc, csv: null, rowIndex: 0 });
        expect(map.size).toBe(0);
    });

    it('covers nested (child) nodes because doc.nodes is flat', async () => {
        const doc = docWith([
            leaf('child', 'text', { kind: 'csv', column: 'sku', fallback: 'N/A' }, 'group-1'),
        ]);
        const map = await prepareResolvedContent({ doc, csv: csv([['A1', 'Bolt']]), rowIndex: 0 });
        expect(map.get('child')).toEqual({ text: 'A1', placeholder: false });
    });

    it('does not mutate the document (invariant 2)', async () => {
        const { engine } = createFakeEngine(() => 'T');
        const doc = docWith([
            leaf('t1', 'text', { kind: 'csv', column: 'sku', fallback: 'F' }),
            leaf('t2', 'text', { kind: 'template', code: 'x', fallback: 'F' }),
        ]);
        const snapshot = structuredClone(doc);
        deepFreeze(doc);

        await expect(
            prepareResolvedContent({ doc, csv: csv([['A1', 'Bolt']]), rowIndex: 0, engine }),
        ).resolves.toBeInstanceOf(Map);
        expect(doc).toEqual(snapshot);
    });

    it('reads the host clock exactly once per call across many nodes', async () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
        const { engine, calls } = createFakeEngine(() => 'T');
        const doc = docWith([
            leaf('t1', 'text', { kind: 'template', code: 'a', fallback: 'F' }),
            leaf('t2', 'text', { kind: 'template', code: 'b', fallback: 'F' }),
            leaf('t3', 'text', { kind: 'csv', column: 'sku', fallback: 'F' }),
        ]);

        await prepareResolvedContent({ doc, csv: csv([['A1', 'Bolt']]), rowIndex: 0, engine });

        expect(nowSpy).toHaveBeenCalledTimes(1);
        expect(calls.every((call) => call.context.now === NOW_MS)).toBe(true);
    });

    it('feeds resolve end to end: override wins, static untouched', async () => {
        const { engine } = createFakeEngine(() => 'Templated');
        const doc = docWith([
            leaf('t1', 'text', { kind: 'csv', column: 'sku', fallback: 'N/A' }),
            leaf('t2', 'text', { kind: 'template', code: 'x', fallback: 'N/A' }),
            leaf('s1', 'text', { kind: 'static', value: 'static' }),
        ]);
        const overrides = await prepareResolvedContent({
            doc,
            csv: csv([['A1', 'Bolt']]),
            rowIndex: 0,
            engine,
        });
        const byId = new Map(resolve(doc, { overrides }).map((node) => [node.id, node]));

        const textOf = (id: string): string | undefined => {
            const node = byId.get(id);
            return node?.type === 'text' ? node.text : undefined;
        };
        expect(textOf('t1')).toBe('A1');
        expect(textOf('t2')).toBe('Templated');
        expect(textOf('s1')).toBe('static');
    });
});

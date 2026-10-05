import { describe, expect, it } from 'vitest';
import { createMemoryAdapter } from '../data/db';
import { createTrustRepo, type TrustRepo } from '../data/trustRepo';
import { createLabelDoc } from './doc/factory';
import type { ContentSource, LabelDoc, Node } from './doc/types';
import { createTrustGate, docHasTemplateSources, normalizeTrustDecision } from './trust';

const source = (kind: ContentSource['kind']): ContentSource => {
    switch (kind) {
        case 'template':
            return { kind: 'template', code: 'return 1', fallback: '' };
        case 'csv':
            return { kind: 'csv', column: 'name', fallback: '' };
        case 'static':
            return { kind: 'static', value: 'hello' };
    }
};

const makeDoc = (kind: ContentSource['kind'], id = 'doc-1'): LabelDoc =>
    createLabelDoc({
        id,
        nodes: [
            {
                id: 'n1',
                parentId: null,
                type: 'text',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                text: source(kind),
            },
        ],
    });

const makeRepo = (): TrustRepo => createTrustRepo(createMemoryAdapter());

describe('createTrustGate — policy resolution', () => {
    it('resolves an absent record to ask', async () => {
        const gate = createTrustGate({ repo: makeRepo() });
        expect(await gate.resolve('missing')).toBe('ask');
    });

    it('runs silently on a persisted always', async () => {
        const repo = makeRepo();
        await repo.set('doc', 'always');
        const gate = createTrustGate({ repo });

        expect(await gate.resolve('doc')).toBe('always');
    });

    it('blocks on a persisted never', async () => {
        const repo = makeRepo();
        await repo.set('doc', 'never');
        const gate = createTrustGate({ repo });

        expect(await gate.resolve('doc')).toBe('never');
    });

    it('a session allow does not persist', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });

        gate.allowOnce('doc');

        expect(await gate.resolve('doc')).toBe('always');
        expect(await repo.get('doc')).toBe('ask');
    });

    it('a session deny does not persist', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });

        gate.denyOnce('doc');

        expect(await gate.resolve('doc')).toBe('never');
        expect(await repo.get('doc')).toBe('ask');
    });

    it('never blocks even after a session allow', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });

        await gate.never('doc');
        gate.allowOnce('doc');

        expect(await gate.resolve('doc')).toBe('never');
        expect(await repo.get('doc')).toBe('never');
    });

    it('a session deny overrides a persisted always', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });

        await gate.always('doc');
        gate.denyOnce('doc');

        expect(await gate.resolve('doc')).toBe('never');
    });

    it('always/never persist without writing the session overlay', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });

        await gate.always('a');
        await gate.never('b');

        expect(await repo.get('a')).toBe('always');
        expect(await repo.get('b')).toBe('never');
        expect(await gate.resolve('a')).toBe('always');
        expect(await gate.resolve('b')).toBe('never');
    });

    it('a Settings revoke lifts a persisted never in the same gate instance', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });
        await gate.never('doc');
        expect(await gate.resolve('doc')).toBe('never');

        // Settings → Revoke. Because `never` did not write the session overlay,
        // dropping the persistent record immediately restores `ask`.
        await repo.remove('doc');

        expect(await gate.resolve('doc')).toBe('ask');
    });

    it('a Settings revoke lifts a persisted always in the same gate instance', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });
        await gate.always('doc');

        await repo.remove('doc');

        expect(await gate.resolve('doc')).toBe('ask');
    });

    it('persisting never supersedes a stale session allow', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });
        gate.allowOnce('doc');
        expect(await gate.resolve('doc')).toBe('always');

        // Explicit Never after a session Allow: the persisted decision wins.
        await gate.never('doc');
        expect(await gate.resolve('doc')).toBe('never');
        expect(await repo.get('doc')).toBe('never');

        // Settings revoke must not let the stale session Allow resurface.
        await repo.remove('doc');
        expect(await gate.resolve('doc')).toBe('ask');
    });

    it('persisting always supersedes a stale session deny', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });
        gate.denyOnce('doc');
        expect(await gate.resolve('doc')).toBe('never');

        await gate.always('doc');

        expect(await gate.resolve('doc')).toBe('always');
        expect(await repo.get('doc')).toBe('always');
    });

    it('a fresh session deny still overrides a later persisted always', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });
        await gate.always('doc');
        gate.denyOnce('doc');

        expect(await gate.resolve('doc')).toBe('never');
    });

    it('gate.remove also drops the session entry for the document', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });
        gate.denyOnce('doc');
        expect(await gate.resolve('doc')).toBe('never');

        await gate.remove('doc');

        expect(await gate.resolve('doc')).toBe('ask');
    });

    it('clearSession drops the overlay without touching persisted records', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });
        await repo.set('doc', 'always');
        gate.denyOnce('doc');

        expect(await gate.resolve('doc')).toBe('never');

        gate.clearSession();

        expect(await gate.resolve('doc')).toBe('always');
        expect(await repo.get('doc')).toBe('always');
    });

    it('sessionEntries snapshots the overlay without exposing the live map', async () => {
        const gate = createTrustGate({ repo: makeRepo() });
        gate.allowOnce('a');
        gate.denyOnce('b');

        const entries = gate.sessionEntries();
        expect(entries).toEqual([
            { docId: 'a', decision: 'always' },
            { docId: 'b', decision: 'never' },
        ]);

        // The returned array is a snapshot: a later overlay change must not
        // mutate it, and the live map is never returned.
        gate.clearSession();
        expect(entries).toHaveLength(2);
        expect(gate.sessionEntries()).toEqual([]);
    });

    it('sessionEntries reflects allowOnce/denyOnce and remove', async () => {
        const gate = createTrustGate({ repo: makeRepo() });
        expect(gate.sessionEntries()).toEqual([]);

        gate.allowOnce('doc');
        expect(gate.sessionEntries()).toEqual([{ docId: 'doc', decision: 'always' }]);

        gate.denyOnce('doc');
        expect(gate.sessionEntries()).toEqual([{ docId: 'doc', decision: 'never' }]);

        await gate.remove('doc');
        expect(gate.sessionEntries()).toEqual([]);
    });

    it('clear resets every stored decision and the session overlay', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });
        await gate.always('a');
        await gate.never('b');

        await gate.clear();

        expect(await repo.list()).toEqual([]);
        expect(await gate.resolve('a')).toBe('ask');
        expect(await gate.resolve('b')).toBe('ask');
    });

    it('accepts an injected session overlay', async () => {
        const session = new Map<string, 'ask' | 'always' | 'never'>([['doc', 'always']]);
        const gate = createTrustGate({ repo: makeRepo(), session });

        expect(await gate.resolve('doc')).toBe('always');
        gate.clearSession();
        expect(session.size).toBe(0);
    });
});

describe('docHasTemplateSources', () => {
    const textNode = (text: unknown): Node =>
        ({
            id: 'n1',
            parentId: null,
            type: 'text',
            visible: true,
            locked: false,
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            text,
        }) as unknown as Node;

    it('is false for a plain static document', () => {
        expect(docHasTemplateSources(makeDoc('static'))).toBe(false);
    });

    it('is false for a csv-bound document', () => {
        expect(docHasTemplateSources(makeDoc('csv'))).toBe(false);
    });

    it('is true for a document with a template source', () => {
        expect(docHasTemplateSources(makeDoc('template'))).toBe(true);
    });

    it('is false for a document with no nodes', () => {
        expect(docHasTemplateSources(createLabelDoc({ nodes: [] }))).toBe(false);
    });

    it('detects a template source on a qr node', () => {
        const doc = createLabelDoc();
        doc.nodes = [
            {
                id: 'q1',
                parentId: null,
                type: 'qr',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                data: source('template'),
            },
        ];
        expect(docHasTemplateSources(doc)).toBe(true);
    });

    it('detects a template source on a barcode node', () => {
        const doc = createLabelDoc();
        doc.nodes = [
            {
                id: 'b1',
                parentId: null,
                type: 'barcode',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                data: source('template'),
            },
        ];
        expect(docHasTemplateSources(doc)).toBe(true);
    });

    it('does not gate csv/static qr or barcode sources', () => {
        const doc = createLabelDoc();
        doc.nodes = [
            {
                id: 'q1',
                parentId: null,
                type: 'qr',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                data: source('csv'),
            },
            {
                id: 'b1',
                parentId: null,
                type: 'barcode',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                data: source('static'),
            },
        ];
        expect(docHasTemplateSources(doc)).toBe(false);
    });

    it('is false for non-carrier node types', () => {
        const doc = createLabelDoc();
        doc.nodes = [
            {
                id: 's1',
                parentId: null,
                type: 'shape',
                shape: 'rectangle',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            },
        ];
        expect(docHasTemplateSources(doc)).toBe(false);
    });

    it('fails closed on a malformed text node (missing source)', () => {
        const doc = createLabelDoc();
        doc.nodes = [textNode(undefined)];
        expect(docHasTemplateSources(doc)).toBe(true);
    });

    it('fails closed on an unrecognized source kind', () => {
        const doc = createLabelDoc();
        doc.nodes = [textNode({ kind: 'mystery' })];
        expect(docHasTemplateSources(doc)).toBe(true);
    });

    it('does not throw on a malformed document shape', () => {
        expect(docHasTemplateSources(null as unknown as LabelDoc)).toBe(false);
        expect(docHasTemplateSources({} as LabelDoc)).toBe(false);
        expect(
            docHasTemplateSources({ nodes: [null, 42, 'x'] } as unknown as LabelDoc),
        ).toBe(false);
    });
});

describe('trust inheritance (decision 39)', () => {
    it('copy carries the source trust to a new id; a fresh import starts at ask', async () => {
        const repo = makeRepo();
        const gate = createTrustGate({ repo });
        await gate.always('source');

        await repo.copy('source', 'duplicate');

        expect(await gate.resolve('duplicate')).toBe('always');
        expect(await gate.resolve('imported')).toBe('ask');
    });
});

describe('normalizeTrustDecision', () => {
    it('passes known decisions and coerces everything else to ask', () => {
        expect(normalizeTrustDecision('always')).toBe('always');
        expect(normalizeTrustDecision('never')).toBe('never');
        expect(normalizeTrustDecision('ask')).toBe('ask');
        expect(normalizeTrustDecision(undefined)).toBe('ask');
        expect(normalizeTrustDecision('bogus')).toBe('ask');
    });
});

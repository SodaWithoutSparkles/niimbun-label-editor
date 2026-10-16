// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installCanvasShim } from '../test/canvasHarness';
import { createLabelDoc } from '../core/doc/factory';
import type { CodeFormat } from '../core/doc/objects';
import type { LabelDoc, Node } from '../core/doc/types';
import { buildPreviewWarnings, type PreviewWarningInputs } from './previewWarnings';
import { clearAssetCache, prepareResolvedAssets } from './render/prepareAssets';
import { resolve } from './render/resolve';

/**
 * P11 W5: warning wiring for a 2D `code` leaf. A payload bwip-js rejects for the
 * chosen format yields no asset and an `'invalid'` badge, which the shared
 * `buildPreviewWarnings` aggregation then surfaces as a jumpable asset entry —
 * the same producer path qr/barcode use (the `code` case wires for free once it
 * reaches `prepareAssets`; this pins that it does).
 *
 * `microqrcode` cannot encode lowercase/byte content without an explicit version,
 * so `'lowercase payload'` fails only for micro QR — a format-specific rejection,
 * not an empty-payload placeholder.
 */

beforeAll(() => {
    installCanvasShim();
});

beforeEach(() => {
    clearAssetCache();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const codeDoc = (format: CodeFormat, value: string): LabelDoc =>
    createLabelDoc({
        backingW: 3000,
        backingH: 2000,
        dpi: 300,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
        nodes: [
            node({
                id: 'c',
                parentId: null,
                type: 'code',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                format,
                data: { kind: 'static', value },
                size: { w: 1500, h: 1500 },
            }),
        ],
    });

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

describe('previewWarnings — code invalid payload (P11 W5)', () => {
    it('surfaces an invalid 2D payload as an "invalid" asset warning', async () => {
        const doc = codeDoc('microqrcode', 'lowercase payload');
        const { warnings } = await prepareResolvedAssets(resolve(doc), doc, {});
        expect(warnings.get('c')).toBe('invalid');

        const entries = buildPreviewWarnings(
            doc,
            inputs({
                assetWarnings: warnings,
                assetLabels: new Map([['c', '2D code']]),
            }),
        );
        expect(entries).toEqual([
            { id: 'asset:c', kind: 'asset', nodeId: 'c', assetWarning: 'invalid', label: '2D code' },
        ]);
    });

    it('emits no warning for a payload the format accepts', async () => {
        const doc = codeDoc('microqrcode', 'LABEL-EDITOR-2D');
        const { warnings } = await prepareResolvedAssets(resolve(doc), doc, {});
        expect(warnings.get('c')).toBeUndefined();
        expect(buildPreviewWarnings(doc, inputs({ assetWarnings: warnings }))).toEqual([]);
    });
});

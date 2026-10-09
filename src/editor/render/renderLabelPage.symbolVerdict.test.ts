// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installCanvasShim } from '../../test/canvasHarness';
import { createLabelDoc } from '../../core/doc/factory';
import type { LabelDoc, Node } from '../../core/doc/types';
import { clearAssetCache } from './prepareAssets';
import { renderLabelPage } from './renderLabelPage';

/**
 * P1 #12: the QR too-small verdict must be decided on the **printed** module
 * pitch, proved end-to-end through `renderLabelPage` (the preview zoom hides the
 * artifact, so `PreviewStage` is not the right seam).
 *
 * `dpi 254` → `imageScale = 0.1` → `minModulePxFor(0.1) = ceil(0.25 * 0.1 * 100)
 * = 3`. The scale-1 `https://example.com` (EC M) symbol is 25 modules, so:
 *   - a 1000 hm box → 100 px → 4 px/module ≥ 3 → **no** too-small warning;
 *   - a 740 hm box → 74 px → 2.96 px/module < 3 → **too-small**.
 * Under the old `scale < minModulePx` verdict both were flagged (bug #12).
 */

beforeAll(() => {
    installCanvasShim();
});

beforeEach(() => {
    clearAssetCache();
});

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const qrDoc = (sizeHm: number): LabelDoc =>
    createLabelDoc({
        backingW: 3000,
        backingH: 2000,
        dpi: 254,
        regions: [{ kind: 'rect', x: 0, y: 0, w: 3000, h: 2000 }],
        nodes: [
            node({
                id: 'q',
                parentId: null,
                type: 'qr',
                visible: true,
                locked: false,
                transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
                data: { kind: 'static', value: 'https://example.com' },
                size: { w: sizeHm, h: sizeHm },
            }),
        ],
    });

describe('renderLabelPage — qr module verdict (P1 #12)', () => {
    it('does not warn too-small when the target module reaches the minimum', async () => {
        const page = await renderLabelPage(qrDoc(1000));
        expect(page.warnings?.get('q')).not.toBe('too-small');
    });

    it('warns too-small when the target module falls below the minimum', async () => {
        const page = await renderLabelPage(qrDoc(740));
        expect(page.warnings?.get('q')).toBe('too-small');
    });
});

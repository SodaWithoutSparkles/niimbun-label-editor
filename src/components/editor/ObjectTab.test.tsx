// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createResourceRepo } from '../../data/resourceRepo';
import { importImageFile } from '../../editor/assetImport';
import { DEFAULT_QR_QUIET_MODULES, MAX_QUIET_ZONE, barcodeQuietModules } from '../../core/doc/objects';
import { bytesProviderFor, createResourceAssetDeps } from './usePreparedAssets';
import type { FontRef, ImageRef, Node } from '../../core/doc/types';
import { SampleRowContext } from './sampleRowContext';
import type { SampleRowState } from './useSampleRow';
import {
    ObjectTab,
    clampSizeHm,
    colorDefault,
    dataContentPatch,
    dataContentValue,
    fontFamilyPatch,
    numberRange,
    shapeKindPatch,
    sizePatch,
} from './ObjectTab';
import { TILE_GAP_HM, alignTransformPatch, tileLayout, tileTransformPatch } from '../../editor/arrange';

vi.mock('../../editor/assetImport', () => ({
    importImageFile: vi.fn(),
    importImageUrl: vi.fn(),
    importFontFile: vi.fn(),
}));

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

const imageNode = (over: Record<string, unknown> = {}): Node =>
    node({
        id: 'a',
        parentId: null,
        type: 'image',
        imageId: '',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 500, h: 300 },
        ...over,
    });

const doc = (nodes: Node[]) =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });

afterEach(() => {
    cleanup();
    vi.mocked(importImageFile).mockReset();
    useStore.setState({
        currentDoc: null,
        selectedNodeIds: [],
        docPast: [],
        resourceRepo: null,
        quantizerDefaults: {},
        defaultQuantizerByType: {},
    });
});

describe('size mapping (must-fix #1)', () => {
    it('clamps to integer hm >= 0 and rejects non-finite input', () => {
        expect(clampSizeHm(12.4)).toBe(12);
        expect(clampSizeHm(12.6)).toBe(13);
        expect(clampSizeHm(-5)).toBe(0);
        expect(clampSizeHm(Number.NaN)).toBe(0);
        expect(clampSizeHm(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it('maps sizeW/sizeH into the {w,h} box, never a bare scalar', () => {
        const source = imageNode();
        expect(sizePatch(source, 'sizeW', 800)).toEqual({ size: { w: 800, h: 300 } });
        expect(sizePatch(source, 'sizeH', 450)).toEqual({ size: { w: 500, h: 450 } });
        // Clamped too.
        expect(sizePatch(source, 'sizeW', -1)).toEqual({ size: { w: 0, h: 300 } });
    });

    it('a sizeW transient edit writes a valid {w,h} and commits one entry', () => {
        const store = [imageNode()];
        useStore.setState({ currentDoc: doc(store), selectedNodeIds: ['a'] });
        const first = useStore.getState().currentDoc!.nodes[0]!;

        useStore.getState().updateNodeTransient('a', sizePatch(first, 'sizeW', 700));
        useStore.getState().updateNodeTransient('a', sizePatch(first, 'sizeW', 750));
        useStore.getState().commitDoc();

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 'a')!;
        expect(persisted.size).toEqual({ w: 750, h: 300 });
        expect(Number.isFinite(persisted.size!.w)).toBe(true);
        expect(useStore.getState().docPast).toHaveLength(1);
    });
});

describe('ObjectTab — image field wiring (P5)', () => {
    it('shows wired image resource + fit controls and no disabled image stubs', () => {
        useStore.setState({ currentDoc: doc([imageNode()]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[imageNode()]} />);
        expect(screen.getByText('Image')).toBeTruthy();
        expect(screen.getByText('Fit')).toBeTruthy();
        // The resolution cap is derived; the stub is gone.
        expect(screen.queryByText('Resolution')).toBeNull();
        expect(screen.queryByText(/image engine/i)).toBeNull();
    });

    it('renders real labels for unmapped ids instead of the raw key', () => {
        useStore.setState({ currentDoc: doc([imageNode()]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[imageNode()]} />);
        expect(screen.queryByText('imageId')).toBeNull();
        expect(screen.queryByText('resolution')).toBeNull();
    });

    it('writes the fit select to the node', () => {
        const selected = imageNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[selected]} />);

        const fitSelect = screen
            .getAllByRole('combobox')
            .find((el) => Array.from((el as HTMLSelectElement).options).some((o) => o.value === 'cover')) as HTMLSelectElement;
        fireEvent.change(fitSelect, { target: { value: 'cover' } });
        fireEvent.blur(fitSelect);

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 'a')!;
        expect((persisted as { fit?: string }).fit).toBe('cover');
    });
});

describe('ObjectTab — quantizer policy (P4)', () => {
    const quantizerSelect = (): HTMLSelectElement =>
        screen.getAllByRole('combobox').find((el) =>
            Array.from((el as HTMLSelectElement).options).some(
                (option) => option.value === 'floydSteinberg',
            ),
        ) as HTMLSelectElement;

    it('renders the wired select with translated option labels', () => {
        useStore.setState({ currentDoc: doc([imageNode()]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[imageNode()]} />);
        const select = quantizerSelect();
        expect(select).toBeTruthy();
        expect(select.value).toBe('');
        expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
            'Type default',
            'Threshold',
            'Floyd–Steinberg',
            'Stucki',
            'Atkinson',
        ]);
    });

    it('writes a chosen hint and clears it back to the type default', () => {
        const selected = imageNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[selected]} />);
        const select = quantizerSelect();

        fireEvent.change(select, { target: { value: 'atkinson' } });
        let persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 'a')!;
        expect(persisted.quantizerHint).toBe('atkinson');

        // The empty option clears the field (absent ⇒ the type default).
        fireEvent.change(select, { target: { value: '' } });
        persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 'a')!;
        expect(persisted.quantizerHint).toBeUndefined();
    });
});

describe('ObjectTab — selecting a node shows wired transform sliders', () => {
    it('renders a Width control bound to the size box', () => {
        const selected = imageNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[selected]} />);
        expect(screen.getByText('Width')).toBeTruthy();
        expect(screen.getByText('Height')).toBeTruthy();
    });

    it('does not throw on render', () => {
        const selected = imageNode();
        render(<ObjectTab selected={[selected]} />);
        // Sanity: the tree mounted.
        expect(document.querySelector('.space-y-3')).toBeTruthy();
    });
});

describe('numberRange', () => {
    it('follows the backing label box and steps scale by 0.05', () => {
        const backing = { backingW: 100, backingH: 50 };
        // A 100-wide label ⇒ x ∈ [-100, 200]; size stays inside the label, with a
        // positive floor so a node can never be sized to 0.
        expect(numberRange('x', backing)).toEqual({ min: -100, max: 200, step: 1 });
        expect(numberRange('y', backing)).toEqual({ min: -50, max: 100, step: 1 });
        expect(numberRange('sizeW', backing)).toEqual({ min: 1, max: 100, step: 1 });
        expect(numberRange('sizeH', backing)).toEqual({ min: 1, max: 50, step: 1 });
        expect(numberRange('scaleX', backing)).toEqual({ min: 0.05, max: 10, step: 0.05 });
        expect(numberRange('scaleY', backing)).toEqual({ min: 0.05, max: 10, step: 0.05 });
    });

    it('keeps every other field’s range and never returns NaN without a backing', () => {
        expect(numberRange('rotDeg', undefined)).toEqual({ min: 0, max: 100000, step: 1 });
        expect(numberRange('strokeWidth', undefined)).toEqual({ min: 0, max: 100000, step: 1 });
        expect(numberRange('fontSize', undefined)).toEqual({ min: 1, max: 2000, step: 1 });
        expect(numberRange('quantizerThreshold', undefined)).toEqual({ min: 0, max: 255, step: 1 });
        expect(numberRange('quantizerStrength', undefined)).toEqual({ min: 0, max: 4, step: 0.1 });
        expect(numberRange('quietZone', undefined)).toEqual({ min: 0, max: MAX_QUIET_ZONE, step: 1 });
    });
});

describe('ObjectTab — transform slider bounds follow the label size', () => {
    /**
     * Open the `PopoverSlider` in the SettingRow labelled `label` and read the
     * min/max/step it hands to both the number input and the range slider, then
     * toggle it closed so the next field opens its own single panel.
     */
    const openField = (label: string) => {
        const row = screen.getByText(label).closest('.items-center.justify-between') as HTMLElement;
        const trigger = row.querySelector('.cursor-pointer') as HTMLElement;
        fireEvent.click(trigger);
        const number = document.querySelector('input[type="number"]') as HTMLInputElement;
        const range = document.querySelector('input[type="range"]') as HTMLInputElement;
        const bounds = {
            number: { min: number.min, max: number.max, step: number.step },
            range: { min: range.min, max: range.max, step: range.step },
        };
        fireEvent.click(trigger);
        return bounds;
    };

    const renderImage = () => {
        const selected = imageNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[selected]} />);
    };

    it('derives x/y from the label and keeps W/H inside it', () => {
        // `doc()` backs the label at 3000 × 2000 hm.
        renderImage();
        const expected = [
            { label: 'X', min: '-3000', max: '6000' },
            { label: 'Y', min: '-2000', max: '4000' },
            { label: 'Width', min: '1', max: '3000' },
            { label: 'Height', min: '1', max: '2000' },
        ];
        for (const { label, min, max } of expected) {
            expect(openField(label).number, label).toEqual({ min, max, step: '1' });
            expect(openField(label).range, label).toEqual({ min, max, step: '1' });
        }
    });

    it('steps Scale X / Scale Y by 0.05 with a usable range', () => {
        renderImage();
        for (const label of ['Scale X', 'Scale Y']) {
            expect(openField(label).number, label).toEqual({ min: '0.05', max: '10', step: '0.05' });
            expect(openField(label).range, label).toEqual({ min: '0.05', max: '10', step: '0.05' });
        }
    });

    it('leaves rotation on its unchanged fixed range', () => {
        renderImage();
        expect(openField('Rotation').number).toEqual({ min: '0', max: '100000', step: '1' });
    });
});

describe('ObjectTab — W/H can never be sized to 0', () => {
    /**
     * Open the labelled field, type `next` into its number input (which commits
     * straight through, bypassing the input's `min`), and return the size the
     * edit actually wrote to the open document.
     */
    const typeSize = (label: string, next: string) => {
        const selected = imageNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[selected]} />);
        const row = screen.getByText(label).closest('.items-center.justify-between') as HTMLElement;
        fireEvent.click(row.querySelector('.cursor-pointer') as HTMLElement);
        fireEvent.change(document.querySelector('input[type="number"]') as HTMLInputElement, {
            target: { value: next },
        });
        return useStore.getState().currentDoc!.nodes.find((n) => n.id === 'a')!.size;
    };

    it('floors a typed 0 on Width to 1 (not 0)', () => {
        expect(typeSize('Width', '0')).toEqual({ w: 1, h: 300 });
    });

    it('floors a typed 0 on Height to 1 (not 0)', () => {
        expect(typeSize('Height', '0')).toEqual({ w: 500, h: 1 });
    });
});

const textNode = (over: Record<string, unknown> = {}): Node =>
    node({
        id: 't',
        parentId: null,
        type: 'text',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        text: { kind: 'static', value: '' },
        size: { w: 2000, h: 800 },
        fontSize: 300,
        ...over,
    });

const shapeNode = (over: Record<string, unknown> = {}): Node =>
    node({
        id: 's',
        parentId: null,
        type: 'shape',
        shape: 'rectangle',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 400, h: 300 },
        ...over,
    });

describe('shape style defaults shown by the inspector (#8)', () => {
    it('shows the resolved default colour when the node omits the field', () => {
        // A shape's no-fill value is the explicit `'transparent'` string, never a
        // black or white swatch, for closed and open shapes alike.
        expect(colorDefault(shapeNode(), 'fill')).toBe('transparent');
        expect(colorDefault(shapeNode(), 'stroke')).toBe('#374151');
        expect(
            colorDefault(shapeNode({ shape: 'line', points: [[0, 0], [100, 0]], closed: false }), 'fill'),
        ).toBe('transparent');
        expect(colorDefault(shapeNode({ shape: 'polygon', closed: true }), 'fill')).toBe('transparent');
        // A qr/barcode symbol defaults to opaque white, unlike a shape's no-fill.
        expect(colorDefault(qrNode(), 'fill')).toBe('#ffffff');
        expect(colorDefault(barcodeNode(), 'fill')).toBe('#ffffff');
        // An unknown colour field has no default and must not silently show black.
        expect(() => colorDefault(shapeNode(), 'notAColour')).toThrow();
    });

    it('renders wired fill/stroke controls for a shape (no disabled stub)', () => {
        const selected = shapeNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);
        expect(screen.getByText('Fill')).toBeTruthy();
        expect(screen.getByText('Stroke')).toBeTruthy();
        expect(screen.getByText('Stroke width')).toBeTruthy();
        // The misleading CSV message must not appear for shape style fields.
        expect(screen.queryByText(/bound to a CSV or template/i)).toBeNull();
    });
});

describe('per-node quantizer params', () => {
    const paramsOf = (id: string) =>
        useStore.getState().currentDoc!.nodes.find((n) => n.id === id)!.quantizerParams;

    const serpentineSelect = (): HTMLSelectElement =>
        screen.getAllByRole('combobox').find((el) =>
            Array.from((el as HTMLSelectElement).options).some((option) => option.value === 'off'),
        ) as HTMLSelectElement;

    /** Open the PopoverSlider row labelled `label` and return its number input. */
    const openQuantizerField = (label: string): HTMLInputElement => {
        const row = screen.getByText(label).closest('.items-center.justify-between') as HTMLElement;
        fireEvent.click(row.querySelector('.cursor-pointer') as HTMLElement);
        return document.querySelector('input[type="number"]') as HTMLInputElement;
    };

    it('edits a bounded threshold value on a threshold-strategy node', () => {
        const selected = textNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        // A threshold node exposes Threshold only — the diffusion knobs do
        // nothing for a point threshold (D-57(c)).
        expect(screen.getByText('128')).toBeTruthy();
        expect(screen.queryByText('Error diffusion')).toBeNull();
        expect(screen.queryByText('Serpentine scan')).toBeNull();

        fireEvent.click(screen.getByText('128'));
        fireEvent.change(document.querySelector('input[type="number"]') as HTMLInputElement, {
            target: { value: '200' },
        });
        fireEvent.pointerUp(document);

        expect(paramsOf('t')).toEqual({ threshold: 200 });
    });

    it('hides every quantizer param for a node that resolves no quantizer (shape without a hint)', () => {
        const selected = shapeNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);

        // The quantizer select is still offered, but the inert params are hidden.
        expect(screen.queryByText('Error diffusion')).toBeNull();
        expect(screen.queryByText('Serpentine scan')).toBeNull();
        expect(screen.queryByText('128')).toBeNull();
    });

    it('shows Threshold only for a shape that resolves the threshold strategy', () => {
        const selected = shapeNode({ quantizerHint: 'threshold' });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);

        expect(screen.getByText('128')).toBeTruthy();
        expect(screen.queryByText('Error diffusion')).toBeNull();
        expect(screen.queryByText('Serpentine scan')).toBeNull();
    });

    it('shows Error diffusion + Serpentine scan for a diffuser strategy', () => {
        const selected = shapeNode({ quantizerHint: 'floydSteinberg' });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);

        expect(screen.getByText('Error diffusion')).toBeTruthy();
        expect(screen.getByText('Serpentine scan')).toBeTruthy();
        // A diffuser hides the threshold knob.
        expect(screen.queryByText('128')).toBeNull();
    });

    it('edits error diffusion through the Object tab', () => {
        const selected = shapeNode({ quantizerHint: 'floydSteinberg' });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);

        const input = openQuantizerField('Error diffusion');
        fireEvent.change(input, { target: { value: '2.5' } });
        fireEvent.pointerUp(document);

        expect(paramsOf('s')).toEqual({ strength: 2.5 });
    });

    it('writes on/off/auto to the node serpentine param', () => {
        const selected = shapeNode({ quantizerHint: 'floydSteinberg' });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);
        const select = serpentineSelect();
        // Absent ⇒ the strategy's settings default, never a pinned `true` (R13-e).
        expect(select.value).toBe('');

        fireEvent.change(select, { target: { value: 'off' } });
        fireEvent.pointerUp(document);
        expect(paramsOf('s')?.serpentine).toBe(false);

        fireEvent.change(select, { target: { value: 'on' } });
        fireEvent.pointerUp(document);
        expect(paramsOf('s')?.serpentine).toBe(true);

        fireEvent.change(select, { target: { value: '' } });
        fireEvent.pointerUp(document);
        expect(paramsOf('s')).toBeUndefined();
    });

    it('reveals the diffusion knobs when a per-type default makes the node a diffuser', () => {
        const selected = textNode();
        useStore.setState({
            currentDoc: doc([selected]),
            selectedNodeIds: ['t'],
            // A `text` node defaults to `threshold`; the setting overrides it.
            defaultQuantizerByType: { text: 'atkinson' },
        });
        render(<ObjectTab selected={[selected]} />);

        expect(screen.getByText('Error diffusion')).toBeTruthy();
        expect(screen.queryByText('128')).toBeNull();
    });
});

describe('shape kind conversion (must-fix #5)', () => {
    it('seeds points from size when converting a rectangle to a polygon', () => {
        const patch = shapeKindPatch(shapeNode() as never, 'polygon') as {
            shape?: string;
            points?: [number, number][];
            closed?: boolean;
        };
        expect(patch.shape).toBe('polygon');
        expect(patch.points).toEqual([
            [0, 0],
            [400, 0],
            [400, 300],
            [0, 300],
        ]);
        expect(patch.closed).toBe(true);
    });

    it('seeds size from the point extent when converting a line to a rectangle', () => {
        const line = shapeNode({ shape: 'line', points: [[0, 0], [1500, 0], [1500, 600]], size: undefined });
        const patch = shapeKindPatch(line as never, 'rectangle') as {
            shape?: string;
            size?: { w: number; h: number };
            points?: unknown;
        };
        expect(patch.shape).toBe('rectangle');
        expect(patch.size).toEqual({ w: 1500, h: 600 });
        expect(patch.points).toBeUndefined();
    });

    it('leaves geometry alone for an in-family change', () => {
        expect(shapeKindPatch(shapeNode() as never, 'ellipse')).toEqual({ shape: 'ellipse' });
        const line = shapeNode({ shape: 'line', points: [[0, 0], [100, 0]] });
        expect(shapeKindPatch(line as never, 'polygon')).toEqual({ shape: 'polygon', closed: true });
    });

    it('converts through the Object tab so the node keeps rendering', () => {
        const selected = shapeNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);

        fireEvent.change(screen.getByDisplayValue('rectangle'), { target: { value: 'polygon' } });

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 's')!;
        expect(persisted.type).toBe('shape');
        expect((persisted as { shape: string }).shape).toBe('polygon');
        expect((persisted as { points?: unknown }).points).toBeDefined();
    });
});

describe('align uses resolved world bounds (must-fix #10)', () => {
    it('aligns a rect to the right edge from its world bounds', () => {
        const child = shapeNode({ size: { w: 400, h: 300 } });
        const byId = new Map([[child.id, child]]);
        const patch = alignTransformPatch(child, byId, 3000, 2000, 'right');
        // World AABB is x=0..400, so right align moves x to 3000-400=2600.
        expect(patch?.transform?.x).toBe(2600);
    });

    it('aligns a line by its point extent, not an undefined size', () => {
        const line = shapeNode({ shape: 'line', points: [[0, 0], [500, 100], [1000, 0]], size: undefined });
        const byId = new Map([[line.id, line]]);
        const patch = alignTransformPatch(line, byId, 3000, 2000, 'right');
        // Point extent 1000 wide => x = 3000-1000 = 2000.
        expect(patch?.transform?.x).toBe(2000);
    });

    it('converts the world delta into the parent local space', () => {
        // Parent is translated by (1000, 500); child local x=0 => world x=1000.
        const parent = node({
            id: 'g',
            parentId: null,
            type: 'group',
            visible: true,
            locked: false,
            transform: { x: 1000, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        const child = shapeNode({ parentId: 'g', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const byId = new Map([
            [parent.id, parent],
            [child.id, child],
        ]);
        const patch = alignTransformPatch(child, byId, 3000, 2000, 'right');
        // World right edge for a 400-wide box under +1000 parent is 3000-1400=1600 world.
        // Local delta = world delta (translation only) => local x = 1600.
        expect(patch?.transform?.x).toBe(1600);
    });

    it('returns null for a geometry-less group (align skips it)', () => {
        const group = node({
            id: 'g',
            parentId: null,
            type: 'group',
            visible: true,
            locked: false,
            transform: { x: 500, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        const byId = new Map([[group.id, group]]);
        // Every edge reads world bounds; a group has none, so nothing is patched.
        for (const edge of ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const) {
            expect(alignTransformPatch(group, byId, 3000, 2000, edge)).toBeNull();
        }
    });
});

// ---------------------------------------------------------------------------
// P5 field wiring
// ---------------------------------------------------------------------------

const qrNode = (over: Record<string, unknown> = {}): Node =>
    node({
        id: 'q',
        parentId: null,
        type: 'qr',
        data: { kind: 'static', value: '' },
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 500, h: 500 },
        ...over,
    });

const barcodeNode = (over: Record<string, unknown> = {}): Node =>
    node({
        id: 'b',
        parentId: null,
        type: 'barcode',
        data: { kind: 'static', value: '' },
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        size: { w: 500, h: 500 },
        ...over,
    });

const withResources = (nodes: Node[], images: ImageRef[] = [], fonts: FontRef[] = []) => {
    const built = createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });
    built.resources.images.push(...images);
    built.resources.fonts.push(...fonts);
    return built;
};

const imageRef: ImageRef = {
    imageId: 'img-1',
    name: 'logo.png',
    alt: 'a logo',
    source: { kind: 'inline', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
    widthPx: 100,
    heightPx: 50,
};

const fontRef: FontRef = {
    fontId: 'font-1',
    familyName: 'My Font',
    name: 'My Font File',
    source: { kind: 'system', descriptor: 'My Font' },
};

const selectWithOption = (value: string): HTMLSelectElement =>
    screen
        .getAllByRole('combobox')
        .find((el) => Array.from((el as HTMLSelectElement).options).some((o) => o.value === value)) as HTMLSelectElement;

describe('ObjectTab — qr / barcode payload + options (P5)', () => {
    it('reads and writes static qr data', () => {
        expect(dataContentValue(qrNode({ data: { kind: 'static', value: 'hi' } }))).toBe('hi');
        expect(dataContentValue(textNode())).toBe('');
        expect(dataContentPatch('x')).toEqual({ data: { kind: 'static', value: 'x' } });
    });

    it('edits the qr payload and error correction through the tab', () => {
        const selected = qrNode({ errorCorrection: 'M' });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['q'] });
        render(<ObjectTab selected={[selected]} />);

        const data = screen.getByLabelText('Data');
        fireEvent.change(data, { target: { value: 'https://x.test' } });
        fireEvent.blur(data);
        const ec = selectWithOption('H');
        fireEvent.change(ec, { target: { value: 'H' } });
        fireEvent.blur(ec);

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 'q')! as {
            data: { value: string };
            errorCorrection?: string;
        };
        expect(persisted.data.value).toBe('https://x.test');
        expect(persisted.errorCorrection).toBe('H');
    });

    it('edits the barcode payload and symbology through the tab', () => {
        const selected = barcodeNode({ symbology: 'code128' });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['b'] });
        render(<ObjectTab selected={[selected]} />);

        const data = screen.getByLabelText('Data');
        fireEvent.change(data, { target: { value: '987' } });
        fireEvent.blur(data);
        const sym = selectWithOption('ean13');
        fireEvent.change(sym, { target: { value: 'ean13' } });
        fireEvent.blur(sym);

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 'b')! as {
            data: { value: string };
            symbology?: string;
        };
        expect(persisted.data.value).toBe('987');
        expect(persisted.symbology).toBe('ean13');
    });

    it('shows the wired fill + derived quiet-zone default for qr / barcode (P2)', () => {
        // An absent `quietZone` means "derived default", so the slider must show
        // the effective value, never 0.
        const qr = qrNode();
        useStore.setState({ currentDoc: doc([qr]), selectedNodeIds: ['q'] });
        const view = render(<ObjectTab selected={[qr]} />);
        expect(screen.getByText('Fill')).toBeTruthy();
        expect(screen.getByText('Quiet zone')).toBeTruthy();
        expect(screen.getByText(String(DEFAULT_QR_QUIET_MODULES))).toBeTruthy();
        view.unmount();

        const barcode = barcodeNode({ symbology: 'code128' });
        useStore.setState({ currentDoc: doc([barcode]), selectedNodeIds: ['b'] });
        render(<ObjectTab selected={[barcode]} />);
        expect(screen.getByText('Fill')).toBeTruthy();
        expect(screen.getByText('Quiet zone')).toBeTruthy();
        expect(screen.getByText(String(barcodeQuietModules('code128')))).toBeTruthy();
    });
});

describe('ObjectTab — text font resource wiring (P5)', () => {
    it('selecting a font resource sets fontId and resolves fontFamily', () => {
        const selected = textNode({ fontFamily: 'sans-serif' });
        useStore.setState({ currentDoc: withResources([selected], [], [fontRef]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        const fontSelect = selectWithOption('font-1');
        fireEvent.change(fontSelect, { target: { value: 'font-1' } });

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')! as {
            fontId?: string;
            fontFamily?: string;
        };
        expect(persisted.fontId).toBe('font-1');
        expect(persisted.fontFamily).toBe('My Font');
    });
});

describe('ObjectTab — asset name/alt rename (P5)', () => {
    it('renames an image ref without changing the node reference', () => {
        const selected = imageNode({ imageId: 'img-1' });
        useStore.setState({ currentDoc: withResources([selected], [imageRef]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[selected]} />);

        const nameInput = screen.getByLabelText('Name');
        fireEvent.change(nameInput, { target: { value: 'brand-logo.png' } });
        fireEvent.blur(nameInput);

        const state = useStore.getState();
        const ref = state.currentDoc!.resources.images.find((r) => r.imageId === 'img-1')!;
        const nodeRef = state.currentDoc!.nodes.find((n) => n.id === 'a')! as { imageId: string };
        expect(ref.name).toBe('brand-logo.png');
        // Renaming never rewrites the node's reference.
        expect(nodeRef.imageId).toBe('img-1');
    });

    it('renames a font ref without changing the node reference', () => {
        const selected = textNode({ fontId: 'font-1', fontFamily: 'My Font' });
        useStore.setState({ currentDoc: withResources([selected], [], [fontRef]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        const nameInput = screen.getByLabelText('Name');
        fireEvent.change(nameInput, { target: { value: 'Heading font' } });
        fireEvent.blur(nameInput);

        const state = useStore.getState();
        const ref = state.currentDoc!.resources.fonts.find((r) => r.fontId === 'font-1')!;
        const nodeRef = state.currentDoc!.nodes.find((n) => n.id === 't')! as { fontId?: string };
        expect(ref.name).toBe('Heading font');
        expect(nodeRef.fontId).toBe('font-1');
    });
});

describe('ObjectTab — replace image in place (#2)', () => {
    it('patches the existing ref source, keeps the node imageId, one undo entry', async () => {
        const selected = imageNode({ imageId: 'img-1' });
        useStore.setState({
            currentDoc: withResources([selected], [imageRef]),
            selectedNodeIds: ['a'],
            resourceRepo: createResourceRepo(createMemoryAdapter()),
        });
        const replacement: ImageRef = {
            imageId: 'img-2',
            name: 'new.png',
            source: { kind: 'local', mediaType: 'image/png', resourceId: 'img-2', fingerprint: 'fp' },
            widthPx: 640,
            heightPx: 480,
        };
        vi.mocked(importImageFile).mockResolvedValue({ ref: replacement, bytes: new Uint8Array() });

        render(<ObjectTab selected={[selected]} />);
        fireEvent.click(screen.getByRole('button', { name: 'Replace image' }));

        // The dialog opens in replace mode; its hidden image picker auto-imports.
        const imageInput = document.querySelector(
            'input[type="file"][accept="image/*"]',
        ) as HTMLInputElement;
        expect(imageInput).toBeTruthy();
        fireEvent.change(imageInput, {
            target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] },
        });

        await waitFor(() => expect(useStore.getState().docPast).toHaveLength(1));

        const state = useStore.getState();
        // No new ref: the existing entry was patched, so nothing is orphaned.
        expect(state.currentDoc!.resources.images).toHaveLength(1);
        const ref = state.currentDoc!.resources.images[0]!;
        expect(ref.imageId).toBe('img-1');
        expect(ref.source).toEqual(replacement.source);
        expect(ref.widthPx).toBe(640);
        expect(ref.heightPx).toBe(480);
        // Name/alt belong to the asset identity and are preserved.
        expect(ref.name).toBe('logo.png');
        expect(ref.alt).toBe('a logo');

        // The node still references the same asset id.
        const nodeRef = state.currentDoc!.nodes.find((n) => n.id === 'a')! as { imageId: string };
        expect(nodeRef.imageId).toBe('img-1');

        // One undo entry fully reverts the replacement.
        state.undoDoc();
        const reverted = useStore.getState().currentDoc!.resources.images[0]!;
        expect(reverted.source).toEqual(imageRef.source);
        expect(reverted.widthPx).toBe(100);
        expect(reverted.heightPx).toBe(50);

        // The replace target is cleared when the dialog closes, so a later
        // insert can never silently patch this ref again (SF1).
        expect(document.querySelector('dialog h2')?.textContent).toBe('Import image');
    });

    it('clears the replace target after cancel (a later open is an insert)', () => {
        const selected = imageNode({ imageId: 'img-1' });
        useStore.setState({ currentDoc: withResources([selected], [imageRef]), selectedNodeIds: ['a'] });
        render(<ObjectTab selected={[selected]} />);

        // Replace mode is armed and shown.
        fireEvent.click(screen.getByRole('button', { name: 'Replace image' }));
        expect(document.querySelector('dialog h2')?.textContent).toBe('Replace image');

        // Cancelling must drop the replace target too, not just close the dialog.
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(document.querySelector('dialog h2')?.textContent).toBe('Import image');
    });
});

describe('createResourceAssetDeps (P5 asset prep seam)', () => {
    it('omits providers without a repo and forwards a finite imageScale', () => {
        const deps = createResourceAssetDeps(null, 2);
        expect(deps.images).toBeUndefined();
        expect(deps.fonts).toBeUndefined();
        expect(deps.imageScale).toBe(2);
    });

    it('drops a non-finite imageScale so print falls back to the doc dpi', () => {
        const deps = createResourceAssetDeps(null, Number.NaN);
        expect('imageScale' in deps).toBe(false);
    });

    it('wires bytes + font providers when a repo is present', async () => {
        const repo = createResourceRepo(createMemoryAdapter());
        await repo.put({ id: 'r1', mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
        const deps = createResourceAssetDeps(repo, 1.5);

        expect(deps.images).toBeDefined();
        expect(deps.fonts).toBeDefined();
        expect(typeof deps.fonts?.ensureFonts).toBe('function');
        expect(await deps.images!.getBytes('r1')).toEqual(new Uint8Array([1, 2, 3]));
        expect(await deps.images!.getBytes('missing')).toBeNull();
    });

    it('bytesProviderFor never throws when the repo read rejects', async () => {
        const provider = bytesProviderFor({
            get: async () => {
                throw new Error('boom');
            },
        } as never);
        expect(await provider.getBytes('x')).toBeNull();
    });
});

describe('ObjectTab — non-static content is never rewritten (must-fix #1)', () => {
    it('renders the data editor disabled for a template qr source', () => {
        const selected = qrNode({ data: { kind: 'template', code: 'x', fallback: 'y' } });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['q'] });
        render(<ObjectTab selected={[selected]} />);
        expect((screen.getByLabelText('Data') as HTMLTextAreaElement).disabled).toBe(true);
    });
});

describe('ObjectTab — fontFamily / fontId stay consistent (must-fix #2)', () => {
    it('fontFamilyPatch detaches a linked font only when the family differs', () => {
        expect(fontFamilyPatch(textNode({ fontId: 'font-1' }), 'Arial', [fontRef])).toStrictEqual({
            fontFamily: 'Arial',
            fontId: undefined,
        });
        expect(fontFamilyPatch(textNode({ fontId: 'font-1' }), 'My Font', [fontRef])).toStrictEqual({
            fontFamily: 'My Font',
        });
        // No link: nothing to detach.
        expect(fontFamilyPatch(textNode(), 'Arial', [fontRef])).toStrictEqual({
            fontFamily: 'Arial',
            fontId: undefined,
        });
    });

    it('clears the linked fontId when the system family select changes', () => {
        const selected = textNode({ fontId: 'font-1', fontFamily: 'My Font' });
        useStore.setState({ currentDoc: withResources([selected], [], [fontRef]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);
        // The system-family select is the one carrying the curated options.
        const familySelect = screen
            .getAllByRole('combobox')
            .find((el) =>
                Array.from((el as HTMLSelectElement).options).some((option) => option.value === 'Arial'),
            ) as HTMLSelectElement;
        fireEvent.change(familySelect, { target: { value: 'Arial' } });
        fireEvent.blur(familySelect);

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')! as {
            fontFamily?: string;
            fontId?: string;
        };
        expect(persisted.fontFamily).toBe('Arial');
        expect(persisted.fontId).toBeUndefined();
    });
});

const trustState = (trust: 'ask' | 'always' | 'never'): SampleRowState => ({
    overrides: new Map(),
    trust,
    blocked: trust === 'never',
    needsApproval: trust === 'ask',
    globalWarnings: [],
    templateErrors: new Map(),
    rowCount: 0,
    error: null,
});

const renderWithTrust = (node: Node, trust: 'ask' | 'always' | 'never') => {
    useStore.setState({ currentDoc: doc([node]), selectedNodeIds: [node.id] });
    return render(
        <SampleRowContext.Provider value={trustState(trust)}>
            <ObjectTab selected={[node]} />
        </SampleRowContext.Provider>,
    );
};

describe('ObjectTab — content source switcher + trust (P6)', () => {
    it('switches a static text source to csv and template through the kind select', () => {
        const selected = textNode({ text: { kind: 'static', value: 'hi' } });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        fireEvent.change(selectWithOption('csv'), { target: { value: 'csv' } });
        let persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')! as { text: unknown };
        expect(persisted.text).toEqual({ kind: 'csv', column: '', fallback: '' });

        // The explicit kind switch is the only path that rewrites the source.
        fireEvent.change(selectWithOption('template'), { target: { value: 'template' } });
        persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')! as { text: unknown };
        expect(persisted.text).toEqual({ kind: 'template', code: '', fallback: '' });
    });

    it('shows the bound csv kind in the content-source select', () => {
        const source = { kind: 'csv' as const, column: 'name', fallback: 'x' };
        const selected = textNode({ text: source });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        // The kind select reflects the bound source (content is edited in the JS
        // tab now that the Object tab's in-place text field is gone).
        expect(selectWithOption('csv').value).toBe('csv');
    });

    it('shows the read-only template trust state', () => {
        renderWithTrust(textNode(), 'ask');
        expect(screen.getByText('Ask each time')).toBeTruthy();
    });

    it('blocks authoring a new template source when trust is never', () => {
        renderWithTrust(textNode(), 'never');
        expect(screen.getByText('Blocked')).toBeTruthy();
        expect(Array.from(selectWithOption('csv').options).map((option) => option.value)).not.toContain('template');

        // `ask` allows authoring the template option; only execution is gated.
        cleanup();
        renderWithTrust(textNode(), 'ask');
        expect(Array.from(selectWithOption('csv').options).map((option) => option.value)).toContain('template');
    });
});

describe('tile vertical / horizontal (H2 mixed-selection alignment)', () => {
    const rect = (id: string, x: number, y: number, w: number, h: number): Node =>
        shapeNode({ id, transform: { x, y, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w, h } });

    /** Apply a tile run to a node list, returning the translated nodes. */
    const applyTile = (nodes: Node[], axis: 'vertical' | 'horizontal'): Node[] => {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const targets = tileLayout(nodes, byId, axis, TILE_GAP_HM);
        return nodes.map((n) => {
            const target = targets.get(n.id)!;
            const patch = tileTransformPatch(n, byId, target.x, target.y)!;
            return { ...n, transform: patch.transform } as Node;
        });
    };

    it('stacks vertically by center: anchor fixed, fixed gap, left edges aligned', () => {
        const a = rect('a', 0, 0, 400, 300);
        const b = rect('b', 100, 1000, 200, 500);
        const c = rect('c', 50, 2000, 300, 300);
        // Deliberately unordered input: ordering is by world center.
        const byId = new Map([c, a, b].map((n) => [n.id, n]));

        const targets = tileLayout([c, a, b], byId, 'vertical', TILE_GAP_HM);

        // Anchor (smallest cy) keeps its own top-left; the rest stack under it.
        expect(targets.get('a')).toEqual({ x: 0, y: 0 });
        expect(targets.get('b')).toEqual({ x: 0, y: 400 });
        expect(targets.get('c')).toEqual({ x: 0, y: 1000 });
    });

    it('tiles horizontally by center with a fixed gap and a shared top edge', () => {
        const a = rect('a', 0, 0, 400, 300);
        const b = rect('b', 1000, 50, 200, 500);
        const c = rect('c', 2000, 200, 300, 300);
        const byId = new Map([a, b, c].map((n) => [n.id, n]));

        const targets = tileLayout([c, b, a], byId, 'horizontal', TILE_GAP_HM);

        expect(targets.get('a')).toEqual({ x: 0, y: 0 });
        expect(targets.get('b')).toEqual({ x: 500, y: 0 });
        expect(targets.get('c')).toEqual({ x: 800, y: 0 });
    });

    it('gaps neighbours by exactly TILE_GAP_HM and preserves each node size', () => {
        const a = rect('a', 0, 0, 400, 300);
        const b = rect('b', 100, 1000, 200, 500);
        const byId = new Map([a, b].map((n) => [n.id, n]));

        const targets = tileLayout([a, b], byId, 'vertical', TILE_GAP_HM);
        const gap = targets.get('b')!.y - (targets.get('a')!.y + a.size!.h);
        expect(gap).toBe(TILE_GAP_HM);

        // Tiling only translates: no size field is touched.
        const patch = tileTransformPatch(b, byId, targets.get('b')!.x, targets.get('b')!.y)!;
        expect(patch).not.toHaveProperty('size');
    });

    it('is idempotent: a second vertical run produces no translation', () => {
        const first = applyTile([rect('a', 0, 0, 400, 300), rect('b', 100, 1000, 200, 500)], 'vertical');
        const second = applyTile(first, 'vertical');
        expect(second.map((n) => n.transform)).toEqual(first.map((n) => n.transform));
    });

    it('is idempotent: a second horizontal run produces no translation', () => {
        const first = applyTile([rect('a', 0, 0, 400, 300), rect('b', 1000, 50, 200, 500)], 'horizontal');
        const second = applyTile(first, 'horizontal');
        expect(second.map((n) => n.transform)).toEqual(first.map((n) => n.transform));
    });

    it('drops a geometry-less group instead of anchoring on its fake origin', () => {
        // A group resolves `[]` local points → degenerate world bounds at 0,0.
        // Left unfiltered, its centre 0 wins the sort, becomes the anchor, and
        // tiles the whole selection into the world origin (the P3 blocker).
        const group = node({
            id: 'g',
            parentId: null,
            type: 'group',
            visible: true,
            locked: false,
            transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        const a = rect('a', 500, 500, 400, 300);
        const b = rect('b', 100, 1000, 200, 500);
        const byId = new Map([group, a, b].map((n) => [n.id, n]));

        const targets = tileLayout([group, a, b], byId, 'vertical', TILE_GAP_HM);
        // The group is neither a target nor the anchor.
        expect(targets.has('g')).toBe(false);
        // The real anchor keeps its own position; the rest stack below it.
        expect(targets.get('a')).toEqual({ x: 500, y: 500 });
        expect(targets.get('b')).toEqual({ x: 500, y: 900 });
    });
});

describe('ObjectTab — adaptive 3-block layout (W1)', () => {
    const headingNames = () => screen.getAllByRole('heading').map((el) => el.textContent);

    it('groups the non-transform fields into TEXT and APPEARANCE blocks', () => {
        const selected = textNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        expect(screen.getByRole('heading', { name: 'Transform' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Text' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
        // Block order: transform → text → appearance.
        expect(headingNames().slice(0, 3)).toEqual(['Transform', 'Text', 'Appearance']);
    });

    it('sizes the block grid 3 → 2 → 1 columns', () => {
        const selected = textNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        const grid = screen.getByTestId('object-blocks');
        expect(grid.className).toContain('grid-cols-1');
        expect(grid.className).toContain('lg:grid-cols-2');
        expect(grid.className).toContain('xl:grid-cols-3');
    });

    it('renders each block once', () => {
        const selected = textNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        for (const name of ['Transform', 'Text', 'Appearance']) {
            expect(screen.getAllByRole('heading', { name })).toHaveLength(1);
        }
    });

    it('moved align + tile out of the tab (they live in the ViewControls block)', () => {
        const selected = shapeNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);

        expect(screen.queryByRole('heading', { name: 'Align' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Tile vertical' })).toBeNull();
    });
});

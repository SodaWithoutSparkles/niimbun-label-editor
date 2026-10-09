// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import { createMemoryAdapter } from '../../data/db';
import { createResourceRepo } from '../../data/resourceRepo';
import { importImageFile } from '../../editor/assetImport';
import { DEFAULT_QR_QUIET_MODULES, barcodeQuietModules } from '../../core/doc/objects';
import { bytesProviderFor, createResourceAssetDeps } from './usePreparedAssets';
import type { FontRef, ImageRef, Node } from '../../core/doc/types';
import { SampleRowContext } from './sampleRowContext';
import type { SampleRowState } from './useSampleRow';
import {
    ObjectTab,
    TILE_GAP_HM,
    alignTransformPatch,
    clampSizeHm,
    colorDefault,
    dataContentPatch,
    dataContentValue,
    fontFamilyPatch,
    shapeKindPatch,
    sizePatch,
    textContentPatch,
    textContentValue,
    tileLayout,
    tileTransformPatch,
} from './ObjectTab';

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
    useStore.setState({ currentDoc: null, selectedNodeIds: [], docPast: [], resourceRepo: null });
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
    it('edits bounded threshold and strength values through the Object tab', () => {
        const selected = textNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        fireEvent.click(screen.getByText('128'));
        fireEvent.change(screen.getAllByRole('spinbutton')[0]!, { target: { value: '200' } });
        fireEvent.click(screen.getAllByText('1').at(-1)!);
        fireEvent.change(screen.getAllByRole('spinbutton')[1]!, { target: { value: '2.5' } });
        fireEvent.pointerUp(document);

        expect(useStore.getState().currentDoc!.nodes[0]?.quantizerParams).toEqual({ threshold: 200, strength: 2.5 });
    });

    it('hides threshold/strength for a node that resolves no quantizer (shape without a hint)', () => {
        const selected = shapeNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);

        // The quantizer select is still offered, but the inert params are hidden.
        expect(screen.queryByText('Dither strength')).toBeNull();
        expect(screen.queryByText('128')).toBeNull();
    });

    it('shows threshold/strength once the node resolves a quantizer (shape with a hint)', () => {
        const selected = shapeNode({ quantizerHint: 'threshold' });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['s'] });
        render(<ObjectTab selected={[selected]} />);

        expect(screen.getByText('Dither strength')).toBeTruthy();
        expect(screen.getByText('128')).toBeTruthy();
    });
});

describe('text content authoring (must-fix #3)', () => {
    it('reads and writes a static ContentSource', () => {
        expect(textContentValue(textNode())).toBe('');
        expect(textContentValue(textNode({ text: { kind: 'static', value: 'hi' } }))).toBe('hi');
        // A non-static source is not editable in the P3 inspector.
        expect(textContentValue(textNode({ text: { kind: 'csv', column: 'c', fallback: 'f' } }))).toBe('');
        expect(textContentPatch('hello')).toEqual({ text: { kind: 'static', value: 'hello' } });
    });

    it('edits the node text through the Object tab', () => {
        const selected = textNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        const field = screen.getByLabelText('Text') as HTMLTextAreaElement;
        fireEvent.change(field, { target: { value: 'authored' } });
        fireEvent.blur(field);

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')!;
        expect(persisted.type).toBe('text');
        expect((persisted as { text: { kind: string; value: string } }).text).toEqual({
            kind: 'static',
            value: 'authored',
        });
        // One committed op after the gesture ends, so it is undoable.
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('batches a multi-keystroke text edit into one undo entry', () => {
        const selected = textNode();
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'], docPast: [] });
        render(<ObjectTab selected={[selected]} />);

        const field = screen.getByLabelText('Text') as HTMLTextAreaElement;
        fireEvent.change(field, { target: { value: 'h' } });
        fireEvent.change(field, { target: { value: 'he' } });
        fireEvent.change(field, { target: { value: 'hel' } });
        fireEvent.change(field, { target: { value: 'hell' } });
        fireEvent.change(field, { target: { value: 'hello' } });
        // No commit until the gesture ends.
        expect(useStore.getState().docPast).toHaveLength(0);
        fireEvent.blur(field);
        expect(useStore.getState().docPast).toHaveLength(1);
        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')!;
        expect((persisted as { text: { value: string } }).text.value).toBe('hello');
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
    it('renders the text editor disabled for a csv source', () => {
        const selected = textNode({ text: { kind: 'csv', column: 'name', fallback: 'x' } });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);
        const field = screen.getByLabelText('Text') as HTMLTextAreaElement;
        expect(field.disabled).toBe(true);
    });

    it('never mutates a csv text source when its editor is edited', () => {
        const source = { kind: 'csv' as const, column: 'name', fallback: 'x' };
        const selected = textNode({ text: source });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);
        const field = screen.getByLabelText('Text') as HTMLTextAreaElement;
        fireEvent.change(field, { target: { value: 'hacked' } });
        fireEvent.blur(field);
        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')!;
        expect((persisted as { text: unknown }).text).toEqual(source);
        expect(useStore.getState().docPast).toHaveLength(0);
    });

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

    it('editing a csv text source never rewrites it to static', () => {
        const source = { kind: 'csv' as const, column: 'name', fallback: 'x' };
        const selected = textNode({ text: source });
        useStore.setState({ currentDoc: doc([selected]), selectedNodeIds: ['t'] });
        render(<ObjectTab selected={[selected]} />);

        // The kind select reflects the bound source.
        expect(selectWithOption('csv').value).toBe('csv');
        const field = screen.getByLabelText('Text') as HTMLTextAreaElement;
        fireEvent.change(field, { target: { value: 'hacked' } });
        fireEvent.blur(field);

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')! as { text: unknown };
        expect(persisted.text).toEqual(source);
        expect(useStore.getState().docPast).toHaveLength(0);
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

    it('tiles the selection through the Tile vertical button', () => {
        const a = rect('a', 0, 0, 400, 300);
        const b = rect('b', 100, 1000, 200, 500);
        useStore.setState({ currentDoc: doc([a, b]), selectedNodeIds: ['a', 'b'], docPast: [] });
        render(<ObjectTab selected={[a, b]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile vertical' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        // The anchor keeps its position, the next node sits directly below it.
        expect(persisted.find((n) => n.id === 'a')!.transform).toEqual({
            x: 0,
            y: 0,
            rotDeg: 0,
            scaleX: 1,
            scaleY: 1,
        });
        expect(persisted.find((n) => n.id === 'b')!.transform).toEqual({
            x: 0,
            y: 400,
            rotDeg: 0,
            scaleX: 1,
            scaleY: 1,
        });
    });

    it('renders a Tile horizontal button that tiles left-to-right', () => {
        const a = rect('a', 0, 0, 400, 300);
        const b = rect('b', 1000, 50, 200, 500);
        useStore.setState({ currentDoc: doc([a, b]), selectedNodeIds: ['a', 'b'], docPast: [] });
        render(<ObjectTab selected={[a, b]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile horizontal' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        expect(persisted.find((n) => n.id === 'a')!.transform.x).toBe(0);
        expect(persisted.find((n) => n.id === 'b')!.transform.x).toBe(500);
        expect(persisted.find((n) => n.id === 'b')!.transform.y).toBe(0);
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

    it('leaves a selected group untouched when tiling a mixed selection', () => {
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
        useStore.setState({ currentDoc: doc([group, a, b]), selectedNodeIds: ['g', 'a', 'b'], docPast: [] });
        render(<ObjectTab selected={[group, a, b]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile vertical' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        // The group is untouched — never teleported to the world origin.
        expect(persisted.find((n) => n.id === 'g')!.transform).toEqual({
            x: 0,
            y: 0,
            rotDeg: 0,
            scaleX: 1,
            scaleY: 1,
        });
        // Real nodes tile relative to their own anchor, not the origin.
        expect(persisted.find((n) => n.id === 'a')!.transform).toEqual({
            x: 500,
            y: 500,
            rotDeg: 0,
            scaleX: 1,
            scaleY: 1,
        });
        expect(persisted.find((n) => n.id === 'b')!.transform).toEqual({
            x: 500,
            y: 900,
            rotDeg: 0,
            scaleX: 1,
            scaleY: 1,
        });
    });
});

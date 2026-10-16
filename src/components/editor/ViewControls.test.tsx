// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import type { Node } from '../../core/doc/types';
import { ViewControls } from './ViewControls';

/**
 * ViewControls (action-plan W2 / D2): the general VIEW block is unchanged and an
 * object-specific icon block sits below it — align 6 / distribute 2 / tile 2
 * only with a selection, and the text-align trio only for a text node. Every
 * icon button keeps an accessible name.
 */

const node = (value: Record<string, unknown>): Node => value as unknown as Node;

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

const groupNode = (): Node =>
    node({
        id: 'g',
        parentId: null,
        type: 'group',
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
    });

const doc = (nodes: Node[]) =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes });

const withSelection = (nodes: Node[]) => {
    useStore.setState({ currentDoc: doc(nodes), selectedNodeIds: nodes.map((n) => n.id), docPast: [] });
};

afterEach(() => {
    cleanup();
    useStore.setState({ currentDoc: null, selectedNodeIds: [], docPast: [] });
});

describe('ViewControls — general VIEW block', () => {
    it('keeps the 9 general icons (grid, snap, rulers, rotate, pan, zoom −/+/fit/real)', () => {
        useStore.setState({ currentDoc: doc([]), selectedNodeIds: [] });
        render(<ViewControls />);
        for (const name of [
            'Grid',
            'Snap',
            'Rulers',
            'Rotate view',
            'Pan',
            'Zoom out',
            'Zoom in',
            'Fit',
            'Real size',
        ]) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
        }
    });

    it('hides the object-specific block with no selection', () => {
        useStore.setState({ currentDoc: doc([]), selectedNodeIds: [] });
        render(<ViewControls />);
        expect(screen.queryByTestId('object-align-icons')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Align left' })).toBeNull();
    });

    it('arms the pan tool from the hand icon and disarms back to select', () => {
        useStore.setState({ currentDoc: doc([]), selectedNodeIds: [], activeTool: 'select' });
        render(<ViewControls />);

        const pan = screen.getByRole('button', { name: 'Pan' });
        // Not armed yet: the toggle reflects the resting select tool.
        expect(pan.getAttribute('aria-pressed')).toBe('false');

        fireEvent.click(pan);
        expect(useStore.getState().activeTool).toBe('pan');
        expect(screen.getByRole('button', { name: 'Pan' }).getAttribute('aria-pressed')).toBe('true');

        // Clicking the active toggle returns to select (no insert is armed).
        fireEvent.click(screen.getByRole('button', { name: 'Pan' }));
        expect(useStore.getState().activeTool).toBe('select');
        expect(screen.getByRole('button', { name: 'Pan' }).getAttribute('aria-pressed')).toBe('false');
    });
});

describe('ViewControls — object-specific block (D2)', () => {
    it('shows align 6 + distribute 2 + tile 2 for a selection, each with an accessible name', () => {
        const selected = shapeNode();
        withSelection([selected]);
        render(<ViewControls />);

        expect(screen.getByTestId('object-align-icons')).toBeTruthy();
        for (const name of [
            'Align left',
            'Align center horizontally',
            'Align right',
            'Align top',
            'Align middle vertically',
            'Align bottom',
            'Distribute horizontally',
            'Distribute vertically',
            'Tile vertical',
            'Tile horizontal',
        ]) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
        }
    });

    it('hides the text-align and bold/italic icons for a non-text selection', () => {
        withSelection([shapeNode()]);
        render(<ViewControls />);
        expect(screen.queryByTestId('text-align-icons')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Text align left' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Italic' })).toBeNull();
    });

    it('aligns the selection to the backing right edge', () => {
        withSelection([shapeNode()]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Align right' }));

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 's')!;
        expect(persisted.transform.x).toBe(2600);
    });

    it('tiles the selection vertically through the icon', () => {
        const a = shapeNode({ id: 'a' });
        const b = shapeNode({ id: 'b', transform: { x: 100, y: 1000, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 200, h: 500 } });
        withSelection([a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile vertical' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        // Anchor keeps its place; the next node sits directly below it.
        expect(persisted.find((n) => n.id === 'a')!.transform).toMatchObject({ x: 0, y: 0 });
        expect(persisted.find((n) => n.id === 'b')!.transform).toMatchObject({ x: 0, y: 400 });
    });

    it('tiles horizontally through the icon', () => {
        const a = shapeNode({ id: 'a' });
        const b = shapeNode({ id: 'b', transform: { x: 1000, y: 50, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 200, h: 500 } });
        withSelection([a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile horizontal' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        expect(persisted.find((n) => n.id === 'b')!.transform).toMatchObject({ x: 500, y: 0 });
    });

    it('lays the object icons out in explicit rows', () => {
        withSelection([textNode()]);
        render(<ViewControls />);

        expect(screen.getByTestId('align-row-horizontal')).toBeTruthy();
        expect(screen.getByTestId('align-row-vertical')).toBeTruthy();
        expect(screen.getByTestId('distribute-tile-row')).toBeTruthy();
        expect(screen.getByTestId('text-align-icons')).toBeTruthy();
    });

    it('uses distinct, correct lucide glyphs for distribute and tile', () => {
        withSelection([shapeNode()]);
        render(<ViewControls />);

        const classNameOf = (name: string) =>
            screen.getByRole('button', { name }).querySelector('svg')?.getAttribute('class') ?? '';

        // Distribute uses the distribute-center family…
        expect(classNameOf('Distribute horizontally')).toContain('lucide-align-horizontal-distribute-center');
        expect(classNameOf('Distribute vertically')).toContain('lucide-align-vertical-distribute-center');
        // …tile uses Columns3 (horizontal) / Rows3 (vertical), not the distribute glyphs.
        expect(classNameOf('Tile horizontal')).toContain('lucide-columns-3');
        expect(classNameOf('Tile vertical')).toContain('lucide-rows-3');
    });

    it('distributes the selection horizontally and writes exactly one undo entry', () => {
        const a = shapeNode({ id: 'a', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const b = shapeNode({
            id: 'b',
            transform: { x: 1000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 200, h: 300 },
        });
        const c = shapeNode({
            id: 'c',
            transform: { x: 2000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        withSelection([a, b, c]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Distribute horizontally' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        // Extremes fixed, interior centre even-spaced: 200/1200/2200.
        expect(persisted.find((n) => n.id === 'a')!.transform.x).toBe(0);
        expect(persisted.find((n) => n.id === 'b')!.transform.x).toBe(1100);
        expect(persisted.find((n) => n.id === 'c')!.transform.x).toBe(2000);
        expect(useStore.getState().docPast).toHaveLength(1);

        useStore.getState().undoDoc();
        expect(useStore.getState().currentDoc!.nodes.find((n) => n.id === 'b')!.transform.x).toBe(1000);
    });

    it('leaves no undo entry when distribute has fewer than three nodes', () => {
        const a = shapeNode({ id: 'a' });
        const b = shapeNode({
            id: 'b',
            transform: { x: 1000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        withSelection([a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Distribute horizontally' }));

        expect(useStore.getState().docPast).toHaveLength(0);
        expect(useStore.getState().currentDoc!.nodes.find((n) => n.id === 'b')!.transform.x).toBe(1000);
    });

    it('leaves a selected geometry-less group untouched when tiling', () => {
        const group = groupNode();
        const a = shapeNode({ id: 'a', transform: { x: 500, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const b = shapeNode({ id: 'b', transform: { x: 100, y: 1000, rotDeg: 0, scaleX: 1, scaleY: 1 }, size: { w: 200, h: 500 } });
        withSelection([group, a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile vertical' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        // Never teleported to the world origin.
        expect(persisted.find((n) => n.id === 'g')!.transform).toMatchObject({ x: 0, y: 0 });
        expect(persisted.find((n) => n.id === 'a')!.transform).toMatchObject({ x: 500, y: 500 });
        expect(persisted.find((n) => n.id === 'b')!.transform).toMatchObject({ x: 500, y: 900 });
    });

    it('aligns a multi-node selection as exactly one undo step', () => {
        const a = shapeNode({ id: 'a' });
        const b = shapeNode({
            id: 'b',
            transform: { x: 100, y: 500, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 200, h: 500 },
        });
        withSelection([a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Align right' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        expect(persisted.find((n) => n.id === 'a')!.transform.x).toBe(2600);
        expect(persisted.find((n) => n.id === 'b')!.transform.x).toBe(2800);
        // One click ⇒ one `docPast` entry, not one per selected node.
        expect(useStore.getState().docPast).toHaveLength(1);

        useStore.getState().undoDoc();
        const reverted = useStore.getState().currentDoc!.nodes;
        expect(reverted.find((n) => n.id === 'a')!.transform.x).toBe(0);
        expect(reverted.find((n) => n.id === 'b')!.transform.x).toBe(100);
    });

    it('tiles a multi-node selection as exactly one undo step', () => {
        const a = shapeNode({ id: 'a' });
        const b = shapeNode({
            id: 'b',
            transform: { x: 100, y: 1000, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 200, h: 500 },
        });
        withSelection([a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Tile vertical' }));

        expect(useStore.getState().docPast).toHaveLength(1);
        expect(
            useStore.getState().currentDoc!.nodes.find((n) => n.id === 'b')!.transform.y,
        ).toBe(400);

        useStore.getState().undoDoc();
        expect(
            useStore.getState().currentDoc!.nodes.find((n) => n.id === 'b')!.transform.y,
        ).toBe(1000);
    });

    it('leaves no undo entry when the align changes nothing', () => {
        // Already flush with the backing right edge: 3000 - 400 = 2600.
        const a = shapeNode({
            id: 'a',
            transform: { x: 2600, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 },
        });
        withSelection([a]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Align right' }));

        expect(useStore.getState().docPast).toHaveLength(0);
    });
});

describe('ViewControls — centre on selection icons', () => {
    it('shows H/V centre-on-selection icons with accessible names and glyphs', () => {
        withSelection([shapeNode()]);
        render(<ViewControls />);

        expect(screen.getByRole('button', { name: 'Centre on selection horizontally' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Centre on selection vertically' })).toBeTruthy();

        const classNameOf = (name: string) =>
            screen.getByRole('button', { name }).querySelector('svg')?.getAttribute('class') ?? '';
        // Lucide names the axis line, not the movement: the horizontal command
        // (moves along x) shows the vertical-line glyph, and vice versa. Asserting
        // the swapped pair guards against a regression back to the wrong glyph.
        expect(classNameOf('Centre on selection horizontally')).toContain('lucide-align-center-vertical');
        expect(classNameOf('Centre on selection vertically')).toContain('lucide-align-center-horizontal');
    });

    it('centres the selection on its own union bounds as exactly one undo step', () => {
        const a = shapeNode({ id: 'a', transform: { x: 0, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        const b = shapeNode({
            id: 'b',
            transform: { x: 1000, y: 40, rotDeg: 0, scaleX: 1, scaleY: 1 },
            size: { w: 200, h: 300 },
        });
        const c = shapeNode({ id: 'c', transform: { x: 2000, y: 0, rotDeg: 0, scaleX: 1, scaleY: 1 } });
        withSelection([a, b, c]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Centre on selection horizontally' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        // Union x=0..2400 → centre 1200; cross-axis (y) preserved.
        expect(persisted.find((n) => n.id === 'a')!.transform).toMatchObject({ x: 1000, y: 0 });
        expect(persisted.find((n) => n.id === 'b')!.transform).toMatchObject({ x: 1100, y: 40 });
        expect(persisted.find((n) => n.id === 'c')!.transform).toMatchObject({ x: 1000, y: 0 });
        expect(useStore.getState().docPast).toHaveLength(1);

        useStore.getState().undoDoc();
        expect(useStore.getState().currentDoc!.nodes.find((n) => n.id === 'b')!.transform.x).toBe(1000);
    });
});

describe('ViewControls — bold / italic toggles', () => {
    it('shows Bold and Italic icon buttons for a text selection', () => {
        withSelection([textNode()]);
        render(<ViewControls />);

        expect(screen.getByTestId('text-align-icons')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Bold' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Italic' })).toBeTruthy();
    });

    it('toggles fontStyle to bold and marks the button pressed (one undo entry)', () => {
        withSelection([textNode()]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')! as { fontStyle?: string };
        expect(persisted.fontStyle).toBe('bold');
        expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true');
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('combines bold + italic into the single "bold italic" style string', () => {
        withSelection([textNode()]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
        fireEvent.click(screen.getByRole('button', { name: 'Italic' }));

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')! as { fontStyle?: string };
        expect(persisted.fontStyle).toBe('bold italic');
        expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Italic' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('removes a token when the active toggle is clicked again', () => {
        withSelection([textNode({ fontStyle: 'bold italic' })]);
        render(<ViewControls />);

        expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')! as { fontStyle?: string };
        expect(persisted.fontStyle).toBe('italic');
    });

    it('applies bold to every selected text node as one undo entry', () => {
        const a = textNode({ id: 't1' });
        const b = textNode({ id: 't2' });
        withSelection([a, b]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

        const persisted = useStore.getState().currentDoc!.nodes;
        expect((persisted.find((n) => n.id === 't1') as { fontStyle?: string }).fontStyle).toBe('bold');
        expect((persisted.find((n) => n.id === 't2') as { fontStyle?: string }).fontStyle).toBe('bold');
        expect(useStore.getState().docPast).toHaveLength(1);
    });
});

describe('ViewControls — text-align icons', () => {
    it('shows left/center/right (no justify) for a text selection', () => {
        withSelection([textNode()]);
        render(<ViewControls />);

        expect(screen.getByTestId('text-align-icons')).toBeTruthy();
        for (const name of ['Text align left', 'Text align center', 'Text align right']) {
            expect(screen.getByRole('button', { name })).toBeTruthy();
        }
        expect(screen.queryByRole('button', { name: /justif/i })).toBeNull();
    });

    it('writes the text alignment to the node (one undo entry)', () => {
        withSelection([textNode()]);
        render(<ViewControls />);

        fireEvent.click(screen.getByRole('button', { name: 'Text align center' }));

        const persisted = useStore.getState().currentDoc!.nodes.find((n) => n.id === 't')!;
        expect((persisted as { align?: string }).align).toBe('center');
        expect(useStore.getState().docPast).toHaveLength(1);
    });

    it('marks the node’s current alignment as pressed', () => {
        withSelection([textNode({ align: 'right' })]);
        render(<ViewControls />);
        expect(screen.getByRole('button', { name: 'Text align right' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Text align left' }).getAttribute('aria-pressed')).toBe('false');
    });
});

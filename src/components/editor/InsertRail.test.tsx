// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createLabelDoc } from '../../core/doc/factory';
import {
    createNodeForInsert,
    DEFAULT_BARCODE_PAYLOAD,
    DEFAULT_CODE_PAYLOAD,
    DEFAULT_QR_PAYLOAD,
} from '../../editor/insertActions';
import { importImageUrl } from '../../editor/assetImport';
import type { ImageRef } from '../../core/doc/types';
import { InsertRail } from './InsertRail';

// The image dialog's import seam is mocked so the flow needs no network/IDB.
vi.mock('../../editor/assetImport', () => ({
    importImageFile: vi.fn(),
    importImageUrl: vi.fn(),
}));

const mockedImportImageUrl = vi.mocked(importImageUrl);

afterEach(() => {
    cleanup();
    useStore.getState().clearActiveTool();
    useStore.setState({ currentDoc: null, selectedNodeIds: [] });
    mockedImportImageUrl.mockReset();
});

const emptyDoc = () =>
    createLabelDoc({ id: 'doc-1', now: 1_700_000_000, backingW: 3000, backingH: 2000, nodes: [] });

describe('InsertRail', () => {
    it('arms a one-shot action and disarms on a second click', () => {
        render(<InsertRail />);
        const text = screen.getByRole('button', { name: 'Text' });
        fireEvent.click(text);
        expect(useStore.getState().activeTool).toBe('text');
        expect(text.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(text);
        expect(useStore.getState().activeTool).toBe('select');
    });

    it('arms a shape variant from the Shape menu', () => {
        render(<InsertRail />);
        fireEvent.click(screen.getByRole('button', { name: 'Shape' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rectangle' }));
        expect(useStore.getState().activeTool).toBe('shape:rectangle');
    });

    it('opens the image import dialog instead of arming', () => {
        render(<InsertRail />);
        fireEvent.click(screen.getByRole('button', { name: 'Image' }));
        // The shared modal is portaled to <body>; its title proves it opened.
        expect(screen.getByText('Import image')).toBeTruthy();
        expect(useStore.getState().activeTool).toBe('select');
    });

    it('arms the QR and barcode one-shot actions (P5)', () => {
        render(<InsertRail />);
        const qr = screen.getByRole('button', { name: 'QR' });
        const barcode = screen.getByRole('button', { name: 'Barcode' });
        expect((qr as HTMLButtonElement).disabled).toBe(false);
        expect((barcode as HTMLButtonElement).disabled).toBe(false);

        fireEvent.click(qr);
        expect(useStore.getState().activeTool).toBe('qr');
        expect(qr.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(barcode);
        expect(useStore.getState().activeTool).toBe('barcode');
    });
});

describe('InsertRail placement (P5)', () => {
    /** Mirror `PreviewStage.handlePointerDown`: build, add, select, disarm. */
    const placeArmed = (x = 100, y = 200) => {
        let id: string | null = null;
        act(() => {
            const node = createNodeForInsert(useStore.getState().activeTool, x, y);
            if (node) {
                id = useStore.getState().addNode(node);
                if (id) useStore.getState().selectNode(id);
            }
            useStore.getState().clearActiveTool();
        });
        return id;
    };

    it('places a QR node with the default payload and disarms', () => {
        useStore.setState({ currentDoc: emptyDoc(), selectedNodeIds: [] });
        render(<InsertRail />);
        const qr = screen.getByRole('button', { name: 'QR' });
        fireEvent.click(qr);
        expect(useStore.getState().activeTool).toBe('qr');

        const id = placeArmed();
        const placed = useStore.getState().currentDoc!.nodes.find((n) => n.id === id)!;
        expect(placed.type).toBe('qr');
        expect((placed as { data: unknown }).data).toEqual({ kind: 'static', value: DEFAULT_QR_PAYLOAD });
        expect(useStore.getState().selectedNodeIds).toEqual([id]);
        expect(useStore.getState().activeTool).toBe('select');
        expect(qr.getAttribute('aria-pressed')).toBe('false');
    });

    it('places a barcode node with the default payload and disarms', () => {
        useStore.setState({ currentDoc: emptyDoc(), selectedNodeIds: [] });
        render(<InsertRail />);
        const barcode = screen.getByRole('button', { name: 'Barcode' });
        fireEvent.click(barcode);
        expect(useStore.getState().activeTool).toBe('barcode');

        const id = placeArmed();
        const placed = useStore.getState().currentDoc!.nodes.find((n) => n.id === id)!;
        expect(placed.type).toBe('barcode');
        expect((placed as { data: unknown }).data).toEqual({
            kind: 'static',
            value: DEFAULT_BARCODE_PAYLOAD,
        });
        expect(useStore.getState().activeTool).toBe('select');
        expect(barcode.getAttribute('aria-pressed')).toBe('false');
    });

    it('arms and places a code node with the default payload (P11)', () => {
        useStore.setState({ currentDoc: emptyDoc(), selectedNodeIds: [] });
        render(<InsertRail />);
        const code = screen.getByRole('button', { name: '2D code' });
        expect((code as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(code);
        expect(useStore.getState().activeTool).toBe('code');
        expect(code.getAttribute('aria-pressed')).toBe('true');

        const id = placeArmed();
        const placed = useStore.getState().currentDoc!.nodes.find((n) => n.id === id)!;
        expect(placed.type).toBe('code');
        expect((placed as { format: string }).format).toBe('datamatrix');
        expect((placed as { data: unknown }).data).toEqual({
            kind: 'static',
            value: DEFAULT_CODE_PAYLOAD,
        });
        expect(useStore.getState().selectedNodeIds).toEqual([id]);
        expect(useStore.getState().activeTool).toBe('select');
        expect(code.getAttribute('aria-pressed')).toBe('false');
    });

    it('imports an image, registers its ImageRef, and places an image node', async () => {
        const ref: ImageRef = {
            imageId: 'img-new',
            name: 'pic.png',
            source: { kind: 'remote', mediaType: 'image/png', url: 'https://x.test/pic.png' },
            widthPx: 200,
            heightPx: 100,
        };
        mockedImportImageUrl.mockResolvedValue({ ref });
        useStore.setState({ currentDoc: emptyDoc(), selectedNodeIds: [] });

        render(<InsertRail />);
        fireEvent.click(screen.getByRole('button', { name: 'Image' }));
        fireEvent.click(screen.getByRole('tab', { name: 'URL' }));
        fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://x.test/pic.png' } });
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        await waitFor(() => expect(useStore.getState().currentDoc!.resources.images).toHaveLength(1));
        const doc = useStore.getState().currentDoc!;
        expect(doc.resources.images[0]!.imageId).toBe('img-new');
        const imageNodes = doc.nodes.filter((n) => n.type === 'image');
        expect(imageNodes).toHaveLength(1);
        expect((imageNodes[0] as { imageId: string }).imageId).toBe('img-new');
        expect(useStore.getState().selectedNodeIds).toEqual([imageNodes[0]!.id]);
        // Importing never arms a tool.
        expect(useStore.getState().activeTool).toBe('select');
    });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { importImageUrl } from '../../editor/assetImport';
import type { ImageRef } from '../../core/doc/types';
import { ImageImportDialog } from './ImageImportDialog';

vi.mock('../../editor/assetImport', () => ({
    importImageFile: vi.fn(),
    importImageUrl: vi.fn(),
}));

const mockedImportImageUrl = vi.mocked(importImageUrl);

afterEach(() => {
    cleanup();
    mockedImportImageUrl.mockReset();
});

const importedRef: ImageRef = {
    imageId: 'img-1',
    name: 'pic.png',
    source: { kind: 'remote', mediaType: 'image/png', url: 'https://x.test/pic.png' },
    widthPx: 100,
    heightPx: 50,
};

const fillUrl = (url: string) => {
    fireEvent.click(screen.getByRole('tab', { name: 'URL' }));
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: url } });
};

describe('ImageImportDialog (P5)', () => {
    it('titles the replace variant distinctly (replace-in-place #2)', () => {
        render(<ImageImportDialog open variant="replace" onClose={vi.fn()} onImported={vi.fn()} />);
        expect(screen.getByText('Replace image')).toBeTruthy();
    });

    it('shows a localised failure message for an import error (must-fix #4)', async () => {
        mockedImportImageUrl.mockRejectedValue(new Error('importImageUrl: fetch failed (404)'));
        render(<ImageImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);
        fillUrl('https://x.test/missing.png');
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        await waitFor(() => expect(screen.getByText(/Import failed/)).toBeTruthy());
        // The raw implementation text is only shown inside the localised wrapper.
        expect(screen.getByText(/fetch failed \(404\)/)).toBeTruthy();
    });

    it('blocks dismissal while importing, then commits on completion (must-fix #5)', async () => {
        let resolveImport: (value: { ref: ImageRef }) => void = () => {};
        mockedImportImageUrl.mockImplementation(
            () => new Promise((resolve) => {
                resolveImport = resolve;
            }),
        );
        const onClose = vi.fn();
        const onImported = vi.fn();
        render(<ImageImportDialog open onClose={onClose} onImported={onImported} />);
        fillUrl('https://x.test/pic.png');
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        // Busy: the close (X) button must be inert.
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).not.toHaveBeenCalled();
        expect(onImported).not.toHaveBeenCalled();

        await act(async () => {
            resolveImport({ ref: importedRef });
        });
        await waitFor(() => expect(onImported).toHaveBeenCalledWith(importedRef));
        expect(onClose).toHaveBeenCalled();
    });

    it('ignores Escape while importing (must-fix #5)', async () => {
        mockedImportImageUrl.mockImplementation(() => new Promise(() => {}));
        const onClose = vi.fn();
        render(<ImageImportDialog open onClose={onClose} onImported={vi.fn()} />);
        fillUrl('https://x.test/pic.png');
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        // The Modal's Escape path must not dismiss (and must not close natively).
        const dialog = document.querySelector('dialog')!;
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        expect(dialog.open).toBe(true);
    });

    it('does not insert when the dialog is dismissed mid-import (must-fix #5)', async () => {
        let resolveImport: (value: { ref: ImageRef }) => void = () => {};
        mockedImportImageUrl.mockImplementation(
            () => new Promise((resolve) => {
                resolveImport = resolve;
            }),
        );
        const onClose = vi.fn();
        const onImported = vi.fn();
        const { rerender } = render(<ImageImportDialog open onClose={onClose} onImported={onImported} />);
        fillUrl('https://x.test/pic.png');
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        // The parent dismisses mid-flight; a late completion must not insert.
        rerender(<ImageImportDialog open={false} onClose={onClose} onImported={onImported} />);
        await act(async () => {
            resolveImport({ ref: importedRef });
        });
        expect(onImported).not.toHaveBeenCalled();
    });
});

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '../../i18n';
import { useStore } from '../../store/useStore';
import { createMemoryAdapter } from '../../data/db';
import { createResourceRepo } from '../../data/resourceRepo';
import { importImageFile } from '../../editor/assetImport';
import type { ImageRef } from '../../core/doc/types';
import { ImageImportDialog } from './ImageImportDialog';

vi.mock('../../editor/assetImport', () => ({
    importImageFile: vi.fn(),
    importImageUrl: vi.fn(),
}));

const mockedImportImageFile = vi.mocked(importImageFile);

afterEach(() => {
    cleanup();
    mockedImportImageFile.mockReset();
    useStore.setState({ resourceRepo: null });
});

const importedRef: ImageRef = {
    imageId: 'img-1',
    name: 'pic.png',
    source: { kind: 'local', mediaType: 'image/png', resourceId: 'img-1' },
    widthPx: 100,
    heightPx: 50,
};

describe('ImageImportDialog file mode', () => {
    it('opens the OS picker when the Import button is pressed', () => {
        render(<ImageImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const clickSpy = vi.spyOn(fileInput, 'click');

        fireEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('auto-imports the file chosen in the picker', async () => {
        useStore.setState({ resourceRepo: createResourceRepo(createMemoryAdapter()) });
        mockedImportImageFile.mockResolvedValue({ ref: importedRef, bytes: new Uint8Array() });
        const onImported = vi.fn();
        render(<ImageImportDialog open onClose={vi.fn()} onImported={onImported} />);
        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

        const picked = new File(['x'], 'pic.png', { type: 'image/png' });
        fireEvent.change(fileInput, { target: { files: [picked] } });

        await waitFor(() => expect(onImported).toHaveBeenCalledWith(importedRef));
        expect(mockedImportImageFile).toHaveBeenCalledWith(picked, expect.anything(), {});
    });
});

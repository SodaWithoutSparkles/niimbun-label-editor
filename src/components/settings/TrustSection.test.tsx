import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));

vi.mock('../common/dialogs', async (orig) => ({
    ...(await orig<typeof import('../common/dialogs')>()),
    confirm: confirmMock,
}));

import '../../i18n';
import { TrustSection } from './TrustSection';
import type { TrustRecord, TrustRepo } from '../../data/trustRepo';

const makeRepo = (records: TrustRecord[] = []): TrustRepo => ({
    get: vi.fn(async (docId: string) => records.find((r) => r.docId === docId)?.decision ?? 'ask'),
    set: vi.fn(async () => {}),
    list: vi.fn(async () => [...records]),
    remove: vi.fn(async (docId: string) => {
        const index = records.findIndex((r) => r.docId === docId);
        if (index >= 0) records.splice(index, 1);
    }),
    clear: vi.fn(async () => {
        records.length = 0;
    }),
    copy: vi.fn(async () => {}),
});

afterEach(() => {
    cleanup();
    confirmMock.mockReset();
});

describe('TrustSection', () => {
    it('renders stored decisions and their labels', async () => {
        const repo = makeRepo([
            { docId: 'doc-a', decision: 'always' },
            { docId: 'doc-b', decision: 'never' },
        ]);
        render(<TrustSection repo={repo} />);

        expect(await screen.findByText('doc-a')).toBeInTheDocument();
        expect(screen.getByText('Always allow')).toBeInTheDocument();
        expect(screen.getByText('doc-b')).toBeInTheDocument();
        expect(screen.getByText('Never allow')).toBeInTheDocument();
    });

    it('shows the empty state when no decisions are stored', async () => {
        render(<TrustSection repo={makeRepo()} />);
        expect(await screen.findByText('No stored template trust decisions.')).toBeInTheDocument();
    });

    it('revokes a single decision and refreshes', async () => {
        const repo = makeRepo([
            { docId: 'doc-a', decision: 'always' },
            { docId: 'doc-b', decision: 'never' },
        ]);
        render(<TrustSection repo={repo} />);

        const revokeButtons = await screen.findAllByText('Revoke');
        fireEvent.click(revokeButtons[0]);

        await waitFor(() => {
            expect(repo.remove).toHaveBeenCalledWith('doc-a');
            expect(screen.queryByText('doc-a')).not.toBeInTheDocument();
        });
        expect(screen.getByText('doc-b')).toBeInTheDocument();
    });

    it('resets all decisions after confirmation', async () => {
        confirmMock.mockResolvedValue(true);
        const repo = makeRepo([{ docId: 'doc-a', decision: 'always' }]);
        render(<TrustSection repo={repo} />);

        fireEvent.click(await screen.findByText('Reset all'));

        await waitFor(() => {
            expect(confirmMock).toHaveBeenCalledTimes(1);
            expect(repo.clear).toHaveBeenCalledTimes(1);
            expect(screen.getByText('No stored template trust decisions.')).toBeInTheDocument();
        });
    });

    it('does not reset when confirmation is cancelled', async () => {
        confirmMock.mockResolvedValue(false);
        const repo = makeRepo([{ docId: 'doc-a', decision: 'always' }]);
        render(<TrustSection repo={repo} />);

        fireEvent.click(await screen.findByText('Reset all'));

        await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
        expect(repo.clear).not.toHaveBeenCalled();
        expect(screen.getByText('doc-a')).toBeInTheDocument();
    });

    it('surfaces an error when a revoke fails and still refreshes', async () => {
        const repo = makeRepo([{ docId: 'doc-a', decision: 'always' }]);
        (repo.remove as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('idb down'));
        render(<TrustSection repo={repo} />);

        fireEvent.click(await screen.findByText('Revoke'));

        expect(
            await screen.findByText('Could not update trust decisions. Try again.'),
        ).toBeInTheDocument();
        expect(repo.list).toHaveBeenCalledTimes(2);
    });

    it('shows the load error state when list rejects', async () => {
        const repo = makeRepo();
        (repo.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('idb down'));
        render(<TrustSection repo={repo} />);

        expect(
            await screen.findByText('Could not read stored trust decisions.'),
        ).toBeInTheDocument();
    });
});

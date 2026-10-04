import { beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmMock, getPendingMock } = vi.hoisted(() => ({
    confirmMock: vi.fn(),
    getPendingMock: vi.fn(),
}));

vi.mock('../components/common/dialogs/dialogService', () => ({
    confirm: confirmMock,
    getPending: getPendingMock,
}));

import {
    promptTemplateTrust,
    resetTrustPromptForTests,
    type TemplateTrustSessionDecision,
} from './trustPrompt';

/**
 * Minimal deferred so a test can hold the prompt open and inspect in-flight
 * dedupe before settling it.
 */
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

/** A pending-request stand-in; only `id` is consulted by the prompt. */
const pendingWith = (id: number) => ({ id });

beforeEach(() => {
    resetTrustPromptForTests();
    confirmMock.mockReset();
    getPendingMock.mockReset();
    // Default: nothing pending (i.e. the dialog was not displaced).
    getPendingMock.mockReturnValue(null);
});

describe('promptTemplateTrust', () => {
    it('returns allow when the user confirms', async () => {
        confirmMock.mockImplementation(() => {
            getPendingMock.mockReturnValueOnce(pendingWith(1));
            return Promise.resolve(true);
        });

        await expect(promptTemplateTrust({ docId: 'a' })).resolves.toBe('allow');
        expect(confirmMock).toHaveBeenCalledTimes(1);
    });

    it('returns deny when the user cancels and no other dialog is pending', async () => {
        confirmMock.mockImplementation(() => {
            getPendingMock.mockReturnValueOnce(pendingWith(1));
            return Promise.resolve(false);
        });

        await expect(promptTemplateTrust({ docId: 'a' })).resolves.toBe('deny');
    });

    it('returns none when a different request is pending (displaced)', async () => {
        confirmMock.mockImplementation(() => {
            // Ours had id 1; by settle time another request (id 2) is pending.
            getPendingMock.mockReturnValueOnce(pendingWith(1));
            getPendingMock.mockReturnValue(pendingWith(2));
            return Promise.resolve(false);
        });

        await expect(promptTemplateTrust({ docId: 'a' })).resolves.toBe('none');
    });

    it('de-dupes concurrent prompts for the same document', async () => {
        const gate = deferred<boolean>();
        confirmMock.mockImplementation(() => {
            getPendingMock.mockReturnValueOnce(pendingWith(1));
            return gate.promise;
        });

        const first = promptTemplateTrust({ docId: 'a', docName: 'Label A' });
        const second = promptTemplateTrust({ docId: 'a', docName: 'Label A' });

        gate.resolve(true);

        await expect(first).resolves.toBe('allow');
        await expect(second).resolves.toBe('allow');
        // One dialog for both callers.
        expect(confirmMock).toHaveBeenCalledTimes(1);
    });

    it('keeps different documents independent (no cross-doc decision leak)', async () => {
        const firstGate = deferred<boolean>();
        const secondGate = deferred<boolean>();
        let call = 0;
        confirmMock.mockImplementation(() => {
            call += 1;
            getPendingMock.mockReturnValueOnce(pendingWith(call));
            return call === 1 ? firstGate.promise : secondGate.promise;
        });

        const docA = promptTemplateTrust({ docId: 'a' });
        const docB = promptTemplateTrust({ docId: 'b' });

        // Two distinct prompts, each keyed by its own document.
        expect(confirmMock).toHaveBeenCalledTimes(2);

        // A is allowed; B is denied. A must never receive B's decision.
        firstGate.resolve(true);
        secondGate.resolve(false);

        await expect(docA).resolves.toBe('allow');
        await expect(docB).resolves.toBe('deny');
    });

    it('allows re-prompting the same document after the first settles', async () => {
        confirmMock.mockImplementation(() => {
            getPendingMock.mockReturnValueOnce(pendingWith(1));
            return Promise.resolve(true);
        });

        await expect(promptTemplateTrust({ docId: 'a' })).resolves.toBe('allow');
        await expect(promptTemplateTrust({ docId: 'a' })).resolves.toBe('allow');
        expect(confirmMock).toHaveBeenCalledTimes(2);
    });

    it('settles each caller exactly once', async () => {
        const gate = deferred<boolean>();
        confirmMock.mockImplementation(() => {
            getPendingMock.mockReturnValueOnce(pendingWith(1));
            return gate.promise;
        });

        const first = promptTemplateTrust({ docId: 'a' });
        const second = promptTemplateTrust({ docId: 'a' });
        const results: TemplateTrustSessionDecision[] = [];
        void first.then((value) => results.push(value));
        void second.then((value) => results.push(value));

        gate.resolve(false);
        await first;
        await second;

        expect(results).toEqual(['deny', 'deny']);
    });
});

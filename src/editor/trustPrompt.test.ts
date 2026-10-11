import { beforeEach, describe, expect, it, vi } from 'vitest';

const { promptChoiceMock } = vi.hoisted(() => ({
    promptChoiceMock: vi.fn(),
}));

vi.mock('../components/common/dialogs/dialogService', () => ({
    promptChoice: promptChoiceMock,
}));

import {
    promptTemplateTrust,
    resetTrustPromptForTests,
    type TemplateTrustDecision,
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

beforeEach(() => {
    resetTrustPromptForTests();
    promptChoiceMock.mockReset();
});

describe('promptTemplateTrust', () => {
    it('maps each of the four choices to its own result', async () => {
        for (const choice of ['allowOnce', 'always', 'denyOnce', 'never'] as const) {
            promptChoiceMock.mockResolvedValueOnce(choice);
            await expect(promptTemplateTrust({ docId: 'a' })).resolves.toBe(choice);
        }
        expect(promptChoiceMock).toHaveBeenCalledTimes(4);
    });

    it('offers the four actions and marks dismissal as denyOnce (cancelValue)', async () => {
        promptChoiceMock.mockResolvedValueOnce('denyOnce');

        await expect(promptTemplateTrust({ docId: 'a' })).resolves.toBe('denyOnce');

        const [options] = promptChoiceMock.mock.calls[0]!;
        expect(options.cancelValue).toBe('denyOnce');
        expect(options.actions.map((action: { value: string }) => action.value)).toEqual([
            'allowOnce',
            'always',
            'denyOnce',
            'never',
        ]);
    });

    it('returns none when the prompt is displaced (null)', async () => {
        promptChoiceMock.mockResolvedValueOnce(null);

        await expect(promptTemplateTrust({ docId: 'a' })).resolves.toBe('none');
    });

    it('de-dupes concurrent prompts for the same document', async () => {
        const gate = deferred<string | null>();
        promptChoiceMock.mockReturnValue(gate.promise);

        const first = promptTemplateTrust({ docId: 'a', docName: 'Label A' });
        const second = promptTemplateTrust({ docId: 'a', docName: 'Label A' });

        gate.resolve('allowOnce');

        await expect(first).resolves.toBe('allowOnce');
        await expect(second).resolves.toBe('allowOnce');
        // One dialog for both callers.
        expect(promptChoiceMock).toHaveBeenCalledTimes(1);
    });

    it('keeps different documents independent (no cross-doc decision leak)', async () => {
        const firstGate = deferred<string | null>();
        const secondGate = deferred<string | null>();
        let call = 0;
        promptChoiceMock.mockImplementation(() => {
            call += 1;
            return call === 1 ? firstGate.promise : secondGate.promise;
        });

        const docA = promptTemplateTrust({ docId: 'a' });
        const docB = promptTemplateTrust({ docId: 'b' });

        // Two distinct prompts, each keyed by its own document.
        expect(promptChoiceMock).toHaveBeenCalledTimes(2);

        // A is allowed; B is denied. A must never receive B's decision.
        firstGate.resolve('allowOnce');
        secondGate.resolve('denyOnce');

        await expect(docA).resolves.toBe('allowOnce');
        await expect(docB).resolves.toBe('denyOnce');
    });

    it('allows re-prompting the same document after the first settles', async () => {
        promptChoiceMock.mockResolvedValue('allowOnce');

        await expect(promptTemplateTrust({ docId: 'a' })).resolves.toBe('allowOnce');
        await expect(promptTemplateTrust({ docId: 'a' })).resolves.toBe('allowOnce');
        expect(promptChoiceMock).toHaveBeenCalledTimes(2);
    });

    it('settles each caller exactly once', async () => {
        const gate = deferred<string | null>();
        promptChoiceMock.mockReturnValue(gate.promise);

        const first = promptTemplateTrust({ docId: 'a' });
        const second = promptTemplateTrust({ docId: 'a' });
        const results: TemplateTrustDecision[] = [];
        void first.then((value) => results.push(value));
        void second.then((value) => results.push(value));

        gate.resolve('denyOnce');
        await first;
        await second;

        expect(results).toEqual(['denyOnce', 'denyOnce']);
    });
});

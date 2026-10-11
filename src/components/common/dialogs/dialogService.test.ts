import { afterEach, describe, expect, it } from 'vitest';
import { getPending, promptChoice, resolvePending } from './dialogService';

/**
 * The `choice` kind's two exit paths must not be conflated: a *user dismissal*
 * resolves the explicit `cancelValue`, while a *displaced* request (the service
 * cancelling an older request) resolves `null`.
 */
afterEach(() => {
    while (getPending()) resolvePending();
});

describe('promptChoice', () => {
    it('resolves with the selected action value', async () => {
        const pending = promptChoice({ message: 'x', actions: [{ value: 'a', label: 'A' }] });

        resolvePending('a');

        await expect(pending).resolves.toBe('a');
    });

    it('resolves the explicit cancel value on a user dismissal', async () => {
        const pending = promptChoice({
            message: 'x',
            actions: [{ value: 'a', label: 'A' }],
            cancelValue: 'denyOnce',
        });

        // The DialogHost routes Escape / backdrop / X to this exact call.
        resolvePending('denyOnce');

        await expect(pending).resolves.toBe('denyOnce');
    });

    it('resolves null when displaced, even with a cancel value set', async () => {
        const first = promptChoice({
            message: 'x',
            actions: [{ value: 'a', label: 'A' }],
            cancelValue: 'denyOnce',
        });

        // A newer request displaces the pending one: the service calls
        // resolvePending() with no argument.
        const second = promptChoice({ message: 'y', actions: [{ value: 'b', label: 'B' }] });

        await expect(first).resolves.toBeNull();

        resolvePending('b');
        await expect(second).resolves.toBe('b');
    });
});

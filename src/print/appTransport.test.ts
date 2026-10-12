// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockTransport } from './mockTransport';
import { NiimbotTransport } from './niimbotAdapter';
import {
    getAppJobRunner,
    getAppTransport,
    resetAppTransport,
    setAppTransportKind,
} from './appTransport';
import type { PrintJob } from './transport';

/** Set the fake page URL the transport factory reads. */
const setUrl = (search: string): void => {
    window.history.pushState({}, '', search);
};

/** A one-page job whose page iterator is never consumed (print is stubbed). */
const onePageJob = (): PrintJob => ({
    totalPages: 1,
    pages: {
        async *[Symbol.asyncIterator]() {
            // Intentionally empty: the stubbed print never pulls a page.
        },
    },
});

afterEach(() => {
    resetAppTransport();
    setUrl('/');
});

describe('appTransport', () => {
    it('selects MockTransport when the URL carries ?mock=1', () => {
        setUrl('/?mock=1');
        expect(getAppTransport()).toBeInstanceOf(MockTransport);
    });

    it('builds a NIIMBOT Bluetooth transport otherwise', () => {
        setUrl('/');
        expect(getAppTransport()).toBeInstanceOf(NiimbotTransport);
    });

    it('memoises one transport and one runner per page load', () => {
        const transport = getAppTransport();
        expect(getAppTransport()).toBe(transport);
        const runner = getAppJobRunner();
        expect(getAppJobRunner()).toBe(runner);
    });

    it('resetAppTransport drops both singletons so the next access rebuilds', () => {
        const transport = getAppTransport();
        const runner = getAppJobRunner();
        resetAppTransport();
        expect(getAppTransport()).not.toBe(transport);
        expect(getAppJobRunner()).not.toBe(runner);
    });

    it('resetAppTransport restores the default Bluetooth kind', async () => {
        await setAppTransportKind('serial');
        resetAppTransport();
        const transport = getAppTransport();
        const disconnect = vi.fn().mockResolvedValue(undefined);
        transport.disconnect = disconnect;
        // A no-op proves the module kind is Bluetooth again, not 'serial'.
        await setAppTransportKind('bluetooth');
        expect(getAppTransport()).toBe(transport);
        expect(disconnect).not.toHaveBeenCalled();
    });

    it('setAppTransportKind rebuilds the transport AND the runner together (R7a)', async () => {
        const before = getAppTransport();
        const runnerBefore = getAppJobRunner();
        const disconnect = vi.fn().mockResolvedValue(undefined);
        before.disconnect = disconnect;

        await setAppTransportKind('serial');

        const after = getAppTransport();
        // New instance, and the old one was torn down first.
        expect(after).not.toBe(before);
        expect(after).toBeInstanceOf(NiimbotTransport);
        expect(disconnect).toHaveBeenCalledTimes(1);
        // The runner must follow: resetting only the transport leaves prints
        // going through the dead instance, which is exactly bug R7a.
        expect(getAppJobRunner()).not.toBe(runnerBefore);

        const print = vi.fn().mockResolvedValue({ pagesPrinted: 1 });
        after.print = print;
        const result = await getAppJobRunner().run(onePageJob());
        expect(print).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ pagesPrinted: 1, cancelled: false });
    });

    it('setAppTransportKind with the live kind is a no-op', async () => {
        const transport = getAppTransport();
        const runner = getAppJobRunner();
        const disconnect = vi.fn().mockResolvedValue(undefined);
        transport.disconnect = disconnect;

        await setAppTransportKind('bluetooth');

        expect(getAppTransport()).toBe(transport);
        expect(getAppJobRunner()).toBe(runner);
        expect(disconnect).not.toHaveBeenCalled();
    });

    it('serializes overlapping swaps so the last requested kind wins', async () => {
        const before = getAppTransport();
        const runnerBefore = getAppJobRunner();
        const disconnect = vi.fn().mockResolvedValue(undefined);
        before.disconnect = disconnect;

        // Fire both without awaiting the first.
        const first = setAppTransportKind('serial');
        const second = setAppTransportKind('bluetooth');
        await Promise.all([first, second]);

        // Exactly one teardown of the pre-burst transport; the queued second
        // swap finds no live transport and must not double-disconnect.
        expect(disconnect).toHaveBeenCalledTimes(1);

        const after = getAppTransport();
        expect(after).not.toBe(before);
        // Transport and runner agree on the same fresh instance.
        expect(getAppJobRunner()).not.toBe(runnerBefore);
        const print = vi.fn().mockResolvedValue({ pagesPrinted: 1 });
        after.print = print;
        await getAppJobRunner().run(onePageJob());
        expect(print).toHaveBeenCalledTimes(1);

        // The last requested kind (bluetooth) won: re-requesting it is a no-op.
        const afterDisconnect = vi.fn().mockResolvedValue(undefined);
        after.disconnect = afterDisconnect;
        await setAppTransportKind('bluetooth');
        expect(getAppTransport()).toBe(after);
        expect(afterDisconnect).not.toHaveBeenCalled();
    });

    it('does not poison the swap chain when a disconnect rejects', async () => {
        const before = getAppTransport();
        before.disconnect = vi.fn().mockRejectedValue(new Error('disconnect refused'));

        // The rejected disconnect is swallowed: the swap still resolves...
        await expect(setAppTransportKind('serial')).resolves.toBeUndefined();

        // ...drops the singleton and leaves the new kind live, and the chain is
        // not poisoned, so a following swap still runs.
        const after = getAppTransport();
        expect(after).not.toBe(before);
        expect(after).toBeInstanceOf(NiimbotTransport);

        const disconnect = vi.fn().mockResolvedValue(undefined);
        after.disconnect = disconnect;
        await setAppTransportKind('bluetooth');
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(getAppTransport()).not.toBe(after);
    });
});

import { MockTransport } from './mockTransport';
import { NiimbotTransport } from './niimbotAdapter';
import { createJobRunner, type JobRunner } from './jobRunner';
import { DEFAULT_CONNECT_METHOD } from '../store/storeDefaults';
import type { ConnectMethod } from '../store/storeTypes';
import type { PrinterTransport } from './transport';

/**
 * App-wide print transport + job runner (P7 W5).
 *
 * One lazy singleton per page load, shared by the connection chip and the print
 * dialog. `?mock=1` swaps in the offline {@link MockTransport} (used by the dev
 * harness and the headed mock smoke); anything else builds the real
 * `NiimbotTransport` on the kind tracked by {@link setAppTransportKind}
 * (Web Bluetooth by default). Construction is lazy — importing
 * this module never instantiates a transport, so the gallery, which only renders
 * the status chip, pays nothing until that chip first reads `getAppTransport()`.
 *
 * `getAppJobRunner()` memoises a runner over that same transport, enforcing the
 * "one print job at a time, app-wide" rule: every dialog instance shares it.
 * {@link setAppTransportKind} drops both singletons together; see bug R7a.
 *
 * No React import: this is plain module state so the transport survives component
 * remounts (gallery ⇄ editor) and can be driven from non-React code.
 */

let transport: PrinterTransport | undefined;
let runner: JobRunner | undefined;

/**
 * Kind the live `transport` was built with (or, when no transport exists yet,
 * the kind the next one will use). Kept in step with `transport`/`runner` so
 * {@link setAppTransportKind} can tell a real swap from a redundant one.
 */
let transportKind: ConnectMethod = DEFAULT_CONNECT_METHOD;

/** True when the URL carries `?mock=1`. Browser-guarded for headless hosts. */
const mockRequested = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return new URLSearchParams(window.location.search).get('mock') === '1';
    } catch {
        return false;
    }
};

/** Whether this page load is running against the offline mock transport. */
export const isMockMode = (): boolean => mockRequested();

/** The shared transport, built on first use. */
export const getAppTransport = (): PrinterTransport => {
    if (!transport) {
        transport = mockRequested()
            ? new MockTransport()
            : new NiimbotTransport({ transport: transportKind });
    }
    return transport;
};

/** The shared one-job-at-a-time runner over {@link getAppTransport}. */
export const getAppJobRunner = (): JobRunner => {
    if (!runner) {
        runner = createJobRunner(getAppTransport());
    }
    return runner;
};

/**
 * Drop both singletons together. They must go in one step: `getAppJobRunner()`
 * captures the transport it was built over, so resetting only the transport
 * leaves prints going through the dead instance (bug R7a).
 */
const dropSingletons = (): void => {
    transport = undefined;
    runner = undefined;
};

/**
 * Switch the shared transport to `kind` (Web Bluetooth ⇄ Web Serial). Mirrors
 * the reference's `initClient` (`references/niimblue/src/stores.ts:61-70`):
 * no-op when the live transport already has that kind, otherwise disconnect it
 * and drop both singletons so the next {@link getAppTransport} rebuilds on the
 * new kind. The disconnect rejection is swallowed — the swap must proceed.
 *
 * A React consumer (the connection chip) must re-read `getAppTransport()`
 * after awaiting this; the module singleton is not reactive.
 *
 * Unlike {@link resetAppTransport} this is the production path: it *does*
 * disconnect the old transport before dropping it.
 */
const doSwap = async (kind: ConnectMethod): Promise<void> => {
    if (transport && transportKind === kind) return;
    if (transport) {
        try {
            await transport.disconnect();
        } catch {
            // The old transport may already be gone; the swap still proceeds.
        }
    }
    dropSingletons();
    transportKind = kind;
};

/**
 * Overlapping swaps must not interleave (two `await`s on the same transport
 * would both disconnect it and let the older call overwrite the newer kind,
 * orphaning a freshly connected transport). A module-level promise chain
 * serializes them; `doSwap` never rejects, so one failed swap cannot poison
 * the queue. After a burst the last requested kind wins.
 */
let swapQueue: Promise<void> = Promise.resolve();

export const setAppTransportKind = (kind: ConnectMethod): Promise<void> => {
    swapQueue = swapQueue.then(() => doSwap(kind));
    return swapQueue;
};

/**
 * Test seam: drop both singletons so the next access rebuilds them (and re-reads
 * `?mock=1`). Does not disconnect the previous transport — a test that opened a
 * connection owns its own teardown. Resets the desired kind to the default, so
 * the rebuilt transport is Bluetooth again.
 */
export const resetAppTransport = (): void => {
    dropSingletons();
    transportKind = DEFAULT_CONNECT_METHOD;
};

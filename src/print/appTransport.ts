import { MockTransport } from './mockTransport';
import { NiimbotTransport } from './niimbotAdapter';
import { createJobRunner, type JobRunner } from './jobRunner';
import type { PrinterTransport } from './transport';

/**
 * App-wide print transport + job runner (P7 W5).
 *
 * One lazy singleton per page load, shared by the connection chip and the print
 * dialog. `?mock=1` swaps in the offline {@link MockTransport} (used by the dev
 * harness and the headed mock smoke); anything else builds the real
 * `NiimbotTransport` on the Bluetooth client. Construction is lazy — importing
 * this module never instantiates a transport, so the gallery, which only renders
 * the status chip, pays nothing until that chip first reads `getAppTransport()`.
 *
 * `getAppJobRunner()` memoises a runner over that same transport, enforcing the
 * "one print job at a time, app-wide" rule: every dialog instance shares it.
 *
 * No React import: this is plain module state so the transport survives component
 * remounts (gallery ⇄ editor) and can be driven from non-React code.
 */

let transport: PrinterTransport | undefined;
let runner: JobRunner | undefined;

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
            : new NiimbotTransport({ transport: 'bluetooth' });
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
 * Test seam: drop both singletons so the next access rebuilds them (and re-reads
 * `?mock=1`). Does not disconnect the previous transport — a test that opened a
 * connection owns its own teardown.
 */
export const resetAppTransport = (): void => {
    transport = undefined;
    runner = undefined;
};

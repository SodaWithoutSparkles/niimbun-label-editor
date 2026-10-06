// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { MockTransport } from './mockTransport';
import { NiimbotTransport } from './niimbotAdapter';
import { getAppJobRunner, getAppTransport, resetAppTransport } from './appTransport';

/** Set the fake page URL the transport factory reads. */
const setUrl = (search: string): void => {
    window.history.pushState({}, '', search);
};

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
});

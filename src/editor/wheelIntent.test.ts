import { describe, expect, it } from 'vitest';

import { classifyWheel, type WheelInput } from './wheelIntent';

const wheel = (overrides: Partial<WheelInput> = {}): WheelInput => ({
    ctrlKey: false,
    shiftKey: false,
    ...overrides,
});

describe('classifyWheel', () => {
    it('treats a plain wheel as a vertical pan', () => {
        expect(classifyWheel(wheel())).toBe('pan-vertical');
    });

    it('treats shift+wheel as a horizontal pan', () => {
        expect(classifyWheel(wheel({ shiftKey: true }))).toBe('pan-horizontal');
    });

    it('treats ctrl+wheel as zoom (mouse wheel)', () => {
        expect(classifyWheel(wheel({ ctrlKey: true }))).toBe('zoom');
    });

    it('treats ctrl+wheel as zoom (touchpad pinch, which the browser reports as ctrlKey)', () => {
        // A pinch is indistinguishable from ctrl+wheel here on purpose.
        expect(classifyWheel(wheel({ ctrlKey: true }))).toBe('zoom');
    });

    it('gives ctrl precedence over shift', () => {
        expect(classifyWheel(wheel({ ctrlKey: true, shiftKey: true }))).toBe('zoom');
    });
});
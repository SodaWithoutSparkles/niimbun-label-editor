import { describe, expect, it } from 'vitest';
import { normalizeRotDeg } from './rotation';

/**
 * Rotation display/persistence normalization. Pure logic: no DOM, no store.
 */

describe('normalizeRotDeg', () => {
    it('passes in-range values through, rounded to 1 decimal', () => {
        expect(normalizeRotDeg(270)).toBe(270);
        expect(normalizeRotDeg(-15)).toBe(-15);
        expect(normalizeRotDeg(90.05)).toBe(90.1);
        expect(normalizeRotDeg(0.04)).toBe(0);
    });

    it('leaves the ±360 endpoints untouched', () => {
        expect(normalizeRotDeg(360)).toBe(360);
        expect(normalizeRotDeg(-360)).toBe(-360);
    });

    it('wraps past ±360 with a signed remainder', () => {
        expect(normalizeRotDeg(400)).toBe(40);
        expect(normalizeRotDeg(-390)).toBe(-30);
        expect(normalizeRotDeg(720)).toBe(0);
        expect(normalizeRotDeg(-720)).toBe(0);
        expect(normalizeRotDeg(740)).toBe(20);
        expect(normalizeRotDeg(-740)).toBe(-20);
        expect(normalizeRotDeg(1e9)).toBe(280);
    });

    it('rounds away float dust', () => {
        expect(normalizeRotDeg(15.100000000000001)).toBe(15.1);
    });

    it('never returns -0', () => {
        expect(Object.is(normalizeRotDeg(-0), -0)).toBe(false);
        expect(normalizeRotDeg(-0)).toBe(0);
        expect(normalizeRotDeg(-720)).toBe(0);
    });

    it('maps non-finite input to 0', () => {
        expect(normalizeRotDeg(NaN)).toBe(0);
        expect(normalizeRotDeg(Infinity)).toBe(0);
        expect(normalizeRotDeg(-Infinity)).toBe(0);
    });
});

import { describe, expect, it } from 'vitest';
import { hmToMm, mmToHm } from '../core/hm';
import { mmString, parseMm } from './mm';

describe('mm display helpers', () => {
    it('round-trips millimetre values that are exact at 0.1 mm', () => {
        for (const mm of [0, 1, 5, 10, 12.5, 25, 38, 78]) {
            expect(parseMm(mmString(mmToHm(mm)))).toBe(mmToHm(mm));
        }
    });

    it('formats an integral mm without a trailing .0', () => {
        expect(mmString(mmToHm(10))).toBe('10');
        expect(mmString(mmToHm(25))).toBe('25');
    });

    it('keeps one decimal for a fractional mm', () => {
        expect(mmString(mmToHm(12.5))).toBe('12.5');
        expect(hmToMm(parseMm('12.5'))).toBe(12.5);
    });

    it('keeps the hundredths digit (hm resolution) without trailing zeros', () => {
        expect(mmString(725)).toBe('7.25');
        expect(mmString(100)).toBe('1');
        expect(mmString(2500)).toBe('25');
        expect(mmString(7800)).toBe('78');
        expect(mmString(1250)).toBe('12.5');
        expect(mmString(1234)).toBe('12.34');
        expect(mmString(9)).toBe('0.09');
        expect(mmString(1)).toBe('0.01');
    });

    it('round-trips every hm value through mmString → parseMm', () => {
        for (const hm of [0, 1, 9, 100, 725, 1234, 1250, 2500, 7800, 99999]) {
            expect(parseMm(mmString(hm))).toBe(hm);
        }
    });

    it('parses a blank or non-numeric string to 0 instead of NaN', () => {
        expect(parseMm('')).toBe(0);
        expect(parseMm('abc')).toBe(0);
        expect(parseMm('Infinity')).toBe(0);
    });
});

import { describe, it, expect } from 'vitest';
import {
  MM_PER_INCH,
  hmToMm,
  hmToPx,
  mmToHm,
  pxToHm,
  roundHm,
} from './hm';

describe('hm unit conversions', () => {
  it('converts mm to hm', () => {
    expect(mmToHm(25.4)).toBe(2540);
    expect(mmToHm(1)).toBe(100);
    expect(mmToHm(0.5)).toBe(50);
  });

  it('round trips mm -> hm -> mm', () => {
    for (const mm of [25.4, 1, 0.5, 12.7, 203]) {
      expect(hmToMm(mmToHm(mm))).toBeCloseTo(mm, 10);
    }
  });

  it('always returns integers from mmToHm', () => {
    for (const mm of [0, 0.333, 1.005, 25.4, 99.999]) {
      expect(Number.isInteger(mmToHm(mm))).toBe(true);
    }
  });

  it('always returns integers from roundHm', () => {
    for (const n of [0, 0.4, 1.5, -2.6, 100.499]) {
      expect(Number.isInteger(roundHm(n))).toBe(true);
    }
  });

  it('converts hm to printer dots at 300 dpi', () => {
    expect(hmToPx(2540, 300)).toBe(300);
  });

  it('converts printer dots to hm at 300 dpi', () => {
    expect(pxToHm(300, 300)).toBe(2540);
  });

  it('converts hm to printer dots at 203 dpi', () => {
    expect(hmToPx(2540, 203)).toBe(203);
  });

  it('exposes the mm per inch constant', () => {
    expect(MM_PER_INCH).toBe(25.4);
  });

  it('pins floating-point rounding for mmToHm', () => {
    // 1.005 * 100 === 100.49999999999999 in IEEE-754, so this rounds to 100.
    expect(mmToHm(1.005)).toBe(100);
  });

  it('rounds half values toward positive infinity', () => {
    // Math.round is half-toward-+Infinity, so -2.5 rounds to -2.
    expect(roundHm(2.5)).toBe(3);
    expect(roundHm(-2.5)).toBe(-2);
  });

  it('always returns integers from pxToHm', () => {
    expect(Number.isInteger(pxToHm(300, 300))).toBe(true);
  });

  it('round trips px -> hm at 203 dpi within rounding', () => {
    // Lossy: hm -> px -> hm can drift by up to one hm unit because each
    // conversion rounds to an integer number of printer dots.
    const px = hmToPx(2540, 203);
    expect(pxToHm(px, 203)).toBeCloseTo(2540, 0);
  });
});

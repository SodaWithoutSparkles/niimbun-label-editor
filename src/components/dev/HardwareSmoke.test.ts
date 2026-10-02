import { describe, expect, it } from 'vitest';
import { encodeBitmap, helloWorldPage, rasterizeText } from './HardwareSmoke';

/** Rebuild the bitmap from an encoded page (mirrors the printer's view). */
function decode(page: ReturnType<typeof helloWorldPage>): boolean[][] {
  const out: boolean[][] = [];
  let y = 0;
  for (const row of page.rowsData) {
    for (let rep = 0; rep < row.repeat; rep += 1) {
      const pixels = Array.from({ length: page.cols }, () => false);
      if (row.dataType === 'pixels' && row.rowDataBlack) {
        for (let x = 0; x < page.cols; x += 1) {
          const byte = x >> 3;
          const bit = x & 7;
          pixels[x] = (row.rowDataBlack[byte] & (1 << (7 - bit))) !== 0;
        }
      }
      out[y] = pixels;
      y += 1;
    }
  }
  return out;
}

describe('hardware smoke page encoding', () => {
  it('pads cols to a multiple of 8', () => {
    const page = encodeBitmap(rasterizeText('HI', 100, 20, 1), 100);
    expect(page.cols).toBe(104);
  });

  it('marks fully-white rows as void with no row data', () => {
    const pixels = rasterizeText('HELLO', 200, 60, 2);
    const page = encodeBitmap(pixels, 200);
    const voids = page.rowsData.filter((r) => r.dataType === 'void');
    expect(voids.length).toBeGreaterThan(0);
    for (const v of voids) {
      expect(v.rowDataBlack).toBeUndefined();
      expect(v.blackPixelsCount).toBe(0);
    }
  });

  it('collapses identical consecutive rows into repeats', () => {
    const pixels = rasterizeText('HELLO', 200, 60, 2);
    const page = encodeBitmap(pixels, 200);
    const totalRows = page.rowsData.reduce((sum, r) => sum + r.repeat, 0);
    expect(totalRows).toBe(60);
    expect(page.rowsData.length).toBeLessThan(60);
  });

  it('produces a hello world page with visible black pixels', () => {
    const page = helloWorldPage(567, 300);
    const grid = decode(page);
    expect(grid.length).toBe(300);
    expect(grid[0].length).toBe(568);
    const blackCount = grid.flat().filter(Boolean).length;
    expect(blackCount).toBeGreaterThan(50);

    // Centred: the leftmost and rightmost black pixels leave a margin.
    let firstBlackCol = Infinity;
    let lastBlackCol = -Infinity;
    for (const row of grid) {
      for (let x = 0; x < row.length; x += 1) {
        if (row[x]) {
          firstBlackCol = Math.min(firstBlackCol, x);
          lastBlackCol = Math.max(lastBlackCol, x);
        }
      }
    }
    expect(firstBlackCol).toBeGreaterThan(0);
    expect(lastBlackCol).toBeLessThan(567);
  });
});

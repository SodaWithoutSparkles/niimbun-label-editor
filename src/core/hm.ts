export type hm = number;

export const MM_PER_INCH = 25.4;

export const mmToHm = (mm: number): hm => Math.round(mm * 100);

export const hmToMm = (value: hm): number => value / 100;

export const hmToPx = (value: hm, dpi: number): number =>
  Math.round((value / 100 / MM_PER_INCH) * dpi);

export const pxToHm = (px: number, dpi: number): hm =>
  Math.round((px / dpi) * MM_PER_INCH * 100);

export const roundHm = (n: number): hm => Math.round(n);

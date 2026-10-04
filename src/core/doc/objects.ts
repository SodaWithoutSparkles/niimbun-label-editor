/**
 * Per-object option unions (P5).
 *
 * These `as const` arrays are the single source of truth for both runtime
 * validation (`validate.ts` derives its allowed sets from them) and the editor
 * UI (dropdowns render exactly these values). Extending a set is a one-line add
 * here — validation and UI follow automatically. Keep this module pure: no
 * imports, no side effects, so it can be consumed from anywhere.
 */

export const BARCODE_SYMBOLOGIES = [
    'code128',
    'code39',
    'code39ext',
    'code93',
    'code93ext',
    'code11',
    'ean13',
    'ean8',
    'ean5',
    'ean2',
    'upca',
    'upce',
    'upc',
    'itf14',
    'interleaved2of5',
    'industrial2of5',
    'iata2of5',
    'datalogic2of5',
    'matrix2of5',
    'coop2of5',
    'code2of5',
    'pharmacode',
    'pharmacode2',
    'rationalizedCodabar',
    'codabar',
    'msi',
    'plessey',
    'telepen',
] as const;
export type BarcodeSymbology = (typeof BARCODE_SYMBOLOGIES)[number];
export const DEFAULT_BARCODE_SYMBOLOGY: BarcodeSymbology = 'code128';

export const IMAGE_FITS = ['contain', 'cover', 'stretch'] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];
export const DEFAULT_IMAGE_FIT: ImageFit = 'contain';

export const QR_ERROR_CORRECTIONS = ['L', 'M', 'Q', 'H'] as const;
export type QrErrorCorrection = (typeof QR_ERROR_CORRECTIONS)[number];
export const DEFAULT_QR_ERROR_CORRECTION: QrErrorCorrection = 'M';

import { describe, expect, it } from 'vitest';
import { resolvePrintDpi } from './resolvedDpi';

describe('resolvePrintDpi', () => {
    it('uses the hint when the setting is off (even with a reported dpi)', () => {
        expect(resolvePrintDpi({ usePrinterDpi: false, printerDpi: 300, docDpi: 203 })).toEqual({
            dpi: 203,
            source: 'hint',
        });
    });

    it('uses the printer dpi when the setting is on and a dpi is reported', () => {
        expect(resolvePrintDpi({ usePrinterDpi: true, printerDpi: 300, docDpi: 203 })).toEqual({
            dpi: 300,
            source: 'printer',
        });
    });

    it('falls back to the hint when the setting is on but no dpi was reported', () => {
        expect(resolvePrintDpi({ usePrinterDpi: true, docDpi: 203 })).toEqual({
            dpi: 203,
            source: 'hint',
        });
    });

    it('falls back to the hint for a non-finite / zero / negative reported dpi', () => {
        for (const printerDpi of [0, -300, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(resolvePrintDpi({ usePrinterDpi: true, printerDpi, docDpi: 203 })).toEqual({
                dpi: 203,
                source: 'hint',
            });
        }
    });
});

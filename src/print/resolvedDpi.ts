/**
 * Effective print raster dpi (P2 W1).
 *
 * The single rule shared by the print preview, the D-31 ink check and the print
 * job (invariant 7): render at the **printer's reported dpi** when the
 * `usePrinterDpi` setting is on and the connected printer reports one, otherwise
 * at the document's **dpi hint** (`doc.label.dpi`).
 *
 * Headless and store-free by design: `src/print/` never imports the store, so
 * the caller threads the setting in. This module has no React/DOM dependency.
 */

export interface PrintDpiInput {
    /** Global persisted preference: prefer the printer-reported dpi. */
    usePrinterDpi: boolean;
    /** Printer-reported device dpi (`PrinterInfo.resolutionClass`), when known. */
    printerDpi?: number;
    /** The document's dpi hint (`doc.label.dpi`). */
    docDpi: number;
}

export interface ResolvedPrintDpi {
    dpi: number;
    /** `'printer'` only when the reported value is actually used. */
    source: 'printer' | 'hint';
}

/**
 * Resolve the effective print dpi: setting off ⇒ hint; setting on but the
 * printer reports nothing usable (absent / non-finite / ≤ 0) ⇒ hint; otherwise
 * the reported printer dpi.
 */
export const resolvePrintDpi = (input: PrintDpiInput): ResolvedPrintDpi => {
    const { usePrinterDpi, printerDpi, docDpi } = input;
    if (
        usePrinterDpi &&
        printerDpi !== undefined &&
        Number.isFinite(printerDpi) &&
        printerDpi > 0
    ) {
        return { dpi: printerDpi, source: 'printer' };
    }
    return { dpi: docDpi, source: 'hint' };
};

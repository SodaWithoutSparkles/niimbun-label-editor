/**
 * Trigger a client-side download of a data URL.
 *
 * The anchor is created in memory and never injected into the document as
 * visible UI -- this is the only allowed DOM creation in the export path.
 */
export const downloadDataUrl = (dataUrl: string, filename: string): void => {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.click();
};

/**
 * Trigger a client-side download of a data URL.
 *
 * The anchor is appended to the document (Firefox/Safari historically require a
 * connected anchor for `download` to fire), kept non-visual, and removed
 * immediately -- it is never rendered as visible UI.
 */
export const downloadDataUrl = (dataUrl: string, filename: string): void => {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
};

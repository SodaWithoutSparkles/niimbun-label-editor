import type Konva from 'konva';

export interface StageCapture {
    dataUrl: string;
    width: number;
    height: number;
}

/**
 * Rasterise a Konva stage for export.
 *
 * Transformers are temporarily detached so selection handles never appear in
 * the captured image, then restored to exactly what they held before. Ported
 * verbatim from the old imperative useCanvasExport hook -- do not "improve"
 * the maths.
 */
export const captureStageData = (
    stage: Konva.Stage | null,
    pixelRatio: number
): StageCapture | null => {
    if (!stage) return null;

    // ShapeRenderer renders one Transformer per selected shape, so there is no
    // single ref that tracks them all. Discover them on the stage instead:
    // Konva's Node._isMatch matches on `this.className`, and Transformer sets
    // `Transformer.prototype.className = 'Transformer'`, so find() returns every
    // transformer regardless of how many shapes are selected.
    const transformers = stage.find<Konva.Transformer>('Transformer');

    // Snapshot each transformer's nodes, then clear them all.
    const priorSelections = transformers.map((tr) => tr.nodes());
    transformers.forEach((tr) => tr.nodes([]));

    try {
        const dataUrl = stage.toDataURL({ pixelRatio });
        const width = stage.width() * pixelRatio;
        const height = stage.height() * pixelRatio;

        return {
            dataUrl,
            width,
            height
        };
    } finally {
        // Always restore the exact prior selection, even when toDataURL throws
        // (e.g. a tainted canvas). 0 transformers -> nothing to do; 1 or N ->
        // each gets its own prior nodes back.
        transformers.forEach((tr, index) => {
            tr.nodes(priorSelections[index]);
        });
    }
};

import React from 'react';
import { Image as KonvaImage, Layer } from 'react-konva';
import type { hm } from '../../core/hm';
import { symbolSceneFunc } from '../../editor/render/konvaFactory';

/**
 * P14 W3 — the live quantized preview's paint surface.
 *
 * A react-konva layer that carries the **viewport transform** (the same
 * `layerAttrs` the `Overlays` layer and the content layer use, so pan / zoom /
 * view rotation apply for free) and draws the rendered page raster at the scene
 * origin at the label's scene size. Nothing here does DOM placement math: the
 * raster covers the whole backing rect, so `x=0, y=0` plus `backingW/backingH` in
 * `hm` aligns it with the label by construction.
 *
 * `listening={false}` (Konva's `pointer-events: none`) on the layer keeps the
 * editor fully interactive underneath: the layer contributes no hit targets, so
 * selection, dragging and the Transformer keep working while the overlay is up.
 *
 * The raster is 1-bit, so it draws **nearest-neighbour** (`symbolSceneFunc`,
 * reused from the factory) — a smoothed black/white page at a fractional zoom
 * would blend the halftone into grey and misrepresent the tone the user is
 * judging. In `normal` mode the overlay is transient (it reverts ~1.5 s after
 * the last change), so covering the selection handles for that moment is the
 * accepted trade-off; in the persistent dithered view (`renderMode ===
 * 'quantized'`) it stays up until the mode is switched off, which is the point
 * of the view.
 */
export interface QuantizedPreviewLayerProps {
    /** The rendered page raster (a fresh canvas per render). */
    image: CanvasImageSource;
    /** Label scene size in `hm` — the raster covers exactly this rect. */
    width: hm;
    height: hm;
    /** The viewport transform attrs, shared with the other scene layers. */
    layerAttrs: {
        x: number;
        y: number;
        rotation: number;
        scaleX: number;
        scaleY: number;
        skewX: number;
    };
}

export const QuantizedPreviewLayer: React.FC<QuantizedPreviewLayerProps> = ({
    image,
    width,
    height,
    layerAttrs,
}) => (
    <Layer listening={false} {...layerAttrs}>
        <KonvaImage
            image={image}
            x={0}
            y={0}
            width={width}
            height={height}
            sceneFunc={symbolSceneFunc}
            listening={false}
        />
    </Layer>
);

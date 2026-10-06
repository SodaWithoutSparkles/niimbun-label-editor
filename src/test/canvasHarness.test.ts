// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import Konva from 'konva';
import { installCanvasShim } from './canvasHarness';

beforeAll(() => {
    installCanvasShim();
});

const containers: HTMLDivElement[] = [];
afterEach(() => {
    for (const container of containers.splice(0)) container.remove();
    for (const stage of Konva.stages.slice()) stage.destroy();
});

function makeStage(width: number, height: number): { stage: Konva.Stage; layer: Konva.Layer } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    containers.push(container);
    const stage = new Konva.Stage({ container, width, height });
    const layer = new Konva.Layer();
    stage.add(layer);
    return { stage, layer };
}

function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): number[] {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('expected a 2d context from the canvas shim');
    return Array.from(context.getImageData(x, y, 1, 1).data);
}

describe('canvas harness: Konva draws to a real Skia surface', () => {
    it('paints a black rect onto a white background', () => {
        const { stage, layer } = makeStage(20, 10);
        layer.add(new Konva.Rect({ x: 0, y: 0, width: 20, height: 10, fill: 'white' }));
        layer.add(new Konva.Rect({ x: 2, y: 2, width: 4, height: 4, fill: 'black' }));
        stage.draw();

        const canvas = layer.getCanvas()._canvas;
        expect(pixelAt(canvas, 4, 4)).toEqual([0, 0, 0, 255]);
        expect(pixelAt(canvas, 15, 5)).toEqual([255, 255, 255, 255]);
    });

    it('renders real glyph pixels for Konva.Text', () => {
        const { stage, layer } = makeStage(120, 40);
        layer.add(new Konva.Rect({ x: 0, y: 0, width: 120, height: 40, fill: 'white' }));
        const text = new Konva.Text({
            x: 4,
            y: 4,
            text: 'Hello',
            fontSize: 24,
            fontFamily: 'Arial',
            fill: 'black',
        });
        layer.add(text);
        stage.draw();

        const context = layer.getCanvas()._canvas.getContext('2d');
        if (!context) throw new Error('expected a 2d context from the canvas shim');
        const data = context.getImageData(0, 0, 120, 40).data;
        let darkPixels = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) darkPixels++;
        }
        expect(text.width()).toBeGreaterThan(0);
        expect(darkPixels).toBeGreaterThan(0);
    });
});

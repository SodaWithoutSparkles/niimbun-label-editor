import { createCanvas, ImageData as NapiImageData } from '@napi-rs/canvas';
import type { Canvas } from '@napi-rs/canvas';

/**
 * Vitest runs under happy-dom, which has no usable 2D canvas. Konva needs a real
 * rasterizer to produce pixels, so this shim backs every `HTMLCanvasElement`
 * with an `@napi-rs/canvas` (Skia) surface. One napi canvas is kept per DOM
 * element in a WeakMap and `getContext('2d')` hands back its context.
 *
 * Nothing is installed on import: call `installCanvasShim()` from a test/beforeAll.
 */

const backing = new WeakMap<HTMLCanvasElement, Canvas>();
let installed = false;

function backingFor(element: HTMLCanvasElement): Canvas {
    let canvas = backing.get(element);
    if (!canvas) {
        canvas = createCanvas(Math.max(1, element.width), Math.max(1, element.height));
        backing.set(element, canvas);
    }
    return canvas;
}

function syncBacking(element: HTMLCanvasElement): void {
    const canvas = backing.get(element);
    if (!canvas) return;
    if (canvas.width !== element.width) canvas.width = element.width;
    if (canvas.height !== element.height) canvas.height = element.height;
}

/** Patches canvas globals. Safe to call more than once; no-op without a DOM. */
export function installCanvasShim(): void {
    if (installed) return;
    if (typeof HTMLCanvasElement === 'undefined') return;
    installed = true;

    const proto = HTMLCanvasElement.prototype;
    const originalGetContext = proto.getContext;

    proto.getContext = function getContext(
        this: HTMLCanvasElement,
        contextId: string,
        ...args: unknown[]
    ): unknown {
        if (contextId !== '2d') {
            return Reflect.apply(originalGetContext, this, [contextId, ...args]);
        }
        const canvas = backingFor(this);
        syncBacking(this);
        return canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext;

    proto.toDataURL = function toDataURL(
        this: HTMLCanvasElement,
        type?: string,
        quality?: number,
    ): string {
        const canvas = backingFor(this);
        syncBacking(this);
        const mime = (type ?? 'image/png') as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
        return canvas.toDataURL(mime, quality);
    };

    proto.toBlob = function toBlob(
        this: HTMLCanvasElement,
        callback: BlobCallback,
        type?: string,
        quality?: number,
    ): void {
        const canvas = backingFor(this);
        syncBacking(this);
        (canvas.toBlob as (cb: BlobCallback, mime?: string, q?: number) => void)(
            callback,
            type,
            quality,
        );
    };

    // Konva assigns `canvas.width`/`.height` *after* obtaining the context, so
    // mirror those writes onto the backing surface. Resizing clears it, exactly
    // like a real canvas.
    for (const property of ['width', 'height'] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, property);
        if (!descriptor?.configurable || !descriptor.get || !descriptor.set) continue;
        const originalGet = descriptor.get;
        const originalSet = descriptor.set;
        Object.defineProperty(proto, property, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get(this: HTMLCanvasElement): number {
                return originalGet.call(this) as number;
            },
            set(this: HTMLCanvasElement, value: number): void {
                originalSet.call(this, value);
                syncBacking(this);
            },
        });
    }

    // happy-dom's ImageData (if any) is not the class napi contexts produce.
    let nativeImageDataWorks = false;
    try {
        nativeImageDataWorks = new globalThis.ImageData(1, 1).data.length === 4;
    } catch {
        nativeImageDataWorks = false;
    }
    if (!nativeImageDataWorks) {
        globalThis.ImageData = NapiImageData as unknown as typeof globalThis.ImageData;
    }
}

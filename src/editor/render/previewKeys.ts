import { quantizerSettingsKey } from '../../core/render';
import type { ResolveContext } from './resolve';
import type { RenderLabelPageOptions } from './renderLabelPage';

/**
 * The preview surfaces' content keys: what makes a raster **stale**.
 *
 * Two different previews must agree on that question — the print dialog's
 * doc-dpi page preview (`components/print/PrintPagePreview`) and the editor's
 * live quantized preview (`components/editor/useQuantizedPreview`). They share
 * these keys instead of each deriving their own, so the two can never drift on
 * what "changed".
 *
 * **Layer.** This is a pure render-layer module (`editor/render/`), not part of
 * either component: the two callers live in *different* component areas, and
 * `code-organization.md` keeps pure helpers out of component files. Nothing here
 * touches Konva, React or the store, so importing it costs nothing.
 */

/**
 * Content key for the render inputs, mirroring `usePrintThumbnails`'s cache
 * key: only the **values** that change pixels. `assets` is deliberately absent
 * (it is read through a ref), so a fresh-but-equal options object does not
 * restart the doc-dpi render — and therefore cannot make a report loop back
 * into another render.
 *
 * The dither settings are folded in through the shared, order-independent
 * `quantizerSettingsKey`: a settings edit must never show a stale raster, while
 * an equal-but-fresh options object must not re-render.
 */
export const previewOptionsKey = (options: RenderLabelPageOptions): string => {
    const offset = options.offset;
    const quantizer = quantizerSettingsKey(
        options.quantizerDefaults,
        options.defaultQuantizerByType,
    );
    return [
        options.dpi ?? '-',
        options.invert === true ? 1 : 0,
        options.mirror === true ? 1 : 0,
        offset === undefined ? '-' : `${offset.x},${offset.y},${offset.type}`,
        quantizer,
    ].join('|');
};

/**
 * Length-prefix one field so the concatenation of fields is **injective**:
 * resolved text is arbitrary (a CSV cell or template output may contain any
 * character, including the separators a naive join would use), and two distinct
 * override maps must never serialize to the same key — that would mask a real
 * content change and leave a stale overlay on screen.
 *
 * With every variable-length field length-prefixed and no separators at all,
 * decoding is unambiguous, so no two field lists can collide. `String.length` is
 * UTF-16 code units; consistent on both the producer and the consumer side.
 */
const field = (value: string): string => `${value.length}:${value}`;

/**
 * Value key of a resolve context's **override map** (the sample-row pre-pass
 * output). A context with nothing to override keys the same whether the caller
 * passes `{}`, `undefined` or an empty map.
 *
 * Keyed by **value**, deliberately not by map identity: for a ticking document
 * (approved templates, or remote globals) `useSampleRow`'s 1 s refresh commits a
 * **fresh map with equal values** every second, so an identity key would mark a
 * live preview stale once a second and hide it for no reason. Order-independent
 * (sorted ids), like `quantizerSettingsKey`: a map rebuilt in another order is
 * the same content.
 *
 * `emptyText` participates unconditionally because `resolve` substitutes it for
 * any source whose static value/fallback is empty (`resolve.ts:427`), override
 * map or not — so two contexts differing only in it can resolve to different
 * pixels.
 */
export const previewOverridesKey = (ctx?: ResolveContext): string => {
    const parts: string[] = [field(ctx?.emptyText ?? '')];
    const overrides = ctx?.overrides;
    if (overrides !== undefined) {
        for (const id of [...overrides.keys()].sort()) {
            const content = overrides.get(id);
            parts.push(
                field(id),
                field(content?.text ?? ''),
                content?.placeholder === true ? '1' : '0',
            );
        }
    }
    return parts.join('');
};

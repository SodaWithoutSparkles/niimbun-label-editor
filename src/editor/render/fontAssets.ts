import type { FontRef, LabelDoc } from '../../core/doc/types';
import type { FontProvider } from './assets';

/**
 * Imported-font loading + availability badges (P5 §2.3, W4).
 *
 * Two halves, deliberately split so the pure part is DOM-free-testable:
 *
 *   - {@link classifyFont} / {@link fontBadges} decide the per-font badge
 *     (`imported` / `system` / `missing`) from availability facts.
 *   - {@link createFontProvider} performs the side effect the render path needs:
 *     register imported `FontFace`s on `document.fonts` and await their load, so
 *     text rasterization can use them. It is strictly best-effort — a missing
 *     DOM, a missing `FontFace` constructor, a hostile `getBytes`, or a font the
 *     browser rejects must never throw into the render pipeline; the text simply
 *     falls back to the resolved `fontFamily`.
 *
 * A missing `bytes` provider lookup is deliberately NOT cached, so a font that
 * becomes available later (bytes written after a failed import) is retried;
 * only successfully loaded fontIds are cached for the store/session lifetime.
 */

export type FontBadge = 'imported' | 'system' | 'missing';

/** Supplies the raw bytes of a locally-stored font resource (IDB `resources`). */
export interface FontBytesProvider {
    getBytes: (id: string) => Promise<Uint8Array | null>;
}

/** Availability facts `classifyFont` maps to a badge. Pure input. */
export interface FontAvailability {
    bytesAvailable: boolean;
    systemAvailable: boolean;
}

/**
 * Map a `FontRef` + availability to its badge. Pure and DOM-free.
 *
 *   - `system`  → `system` when installed, else `missing` (never silently trust
 *     a system family the host does not have).
 *   - `imported` → `imported` when its bytes resolve, else `missing`.
 */
export const classifyFont = (ref: FontRef, opts: FontAvailability): FontBadge => {
    if (ref.source.kind === 'system') {
        return opts.systemAvailable ? 'system' : 'missing';
    }
    return opts.bytesAvailable ? 'imported' : 'missing';
};

/**
 * Whether a system family is installed. When the platform cannot answer
 * (`document.fonts` absent, or `check` unavailable/throws) the font is treated
 * as available: "unknown" must not be reported as a broken/missing font.
 */
const systemFontAvailable = (familyName: string): boolean => {
    if (typeof document === 'undefined') return true;
    const fontSet = document.fonts;
    if (!fontSet || typeof fontSet.check !== 'function') return true;
    try {
        return fontSet.check(`1em "${familyName}"`);
    } catch {
        return true;
    }
};

/**
 * Whether an imported font's bytes currently resolve. Only `local` imports can
 * be checked here (via the bytes provider); `inline`/`remote`/`external`
 * imports are unresolvable in this synchronous-availability pass, so they are
 * treated as available rather than mislabelled `missing`.
 */
const importedBytesAvailable = async (
    ref: FontRef,
    deps: FontBytesProvider,
): Promise<boolean> => {
    if (ref.source.kind !== 'imported') return false;
    const asset = ref.source.asset;
    if (asset.kind !== 'local') return true;
    try {
        return (await deps.getBytes(asset.resourceId)) !== null;
    } catch {
        return false;
    }
};

/**
 * Badge every `FontRef` in a document, keyed by `fontId`. Never throws: a
 * provider failure degrades that font to `missing` (or, for system fonts, uses
 * the platform check).
 */
export const fontBadges = async (
    doc: LabelDoc,
    deps: FontBytesProvider,
): Promise<Map<string, FontBadge>> => {
    const badges = new Map<string, FontBadge>();
    for (const ref of doc.resources.fonts) {
        const bytesAvailable =
            ref.source.kind === 'imported' ? await importedBytesAvailable(ref, deps) : false;
        const systemAvailable =
            ref.source.kind === 'system' ? systemFontAvailable(ref.familyName) : false;
        badges.set(ref.fontId, classifyFont(ref, { bytesAvailable, systemAvailable }));
    }
    return badges;
};

/** The `FontFace` constructor shape this module needs (feature-detected). */
type FontFaceCtor = new (family: string, source: Uint8Array) => FontFace;

/**
 * Build the render-time {@link FontProvider}: registers every imported
 * `FontRef` backed by `local` bytes as a `FontFace` and awaits its load.
 *
 * Registered fontIds are cached, so repeated `ensureFonts` calls for the same
 * document are cheap and a font is never added twice. All failure modes
 * (no DOM, no `FontFace`, no `document.fonts`, missing bytes, a rejected load)
 * are swallowed — the caller keeps rendering with the browser fallback.
 */
export const createFontProvider = (deps: FontBytesProvider): FontProvider => {
    const loaded = new Set<string>();

    return {
        async ensureFonts(doc: LabelDoc): Promise<void> {
            try {
                if (typeof document === 'undefined') return;
                const FontFaceImpl = (globalThis as { FontFace?: FontFaceCtor }).FontFace;
                if (typeof FontFaceImpl !== 'function') return;
                const fontSet = document.fonts;
                if (!fontSet || typeof fontSet.add !== 'function') return;

                for (const ref of doc.resources.fonts) {
                    if (ref.source.kind !== 'imported') continue;
                    const asset = ref.source.asset;
                    if (asset.kind !== 'local') continue;
                    if (loaded.has(ref.fontId)) continue;
                    try {
                        const bytes = await deps.getBytes(asset.resourceId);
                        if (!bytes) continue;
                        const face = new FontFaceImpl(ref.familyName, bytes);
                        fontSet.add(face);
                        await face.load();
                        loaded.add(ref.fontId);
                    } catch {
                        // A rejected FontFace/load falls back to the browser default.
                    }
                }
            } catch {
                // A hostile host (throwing getters) must not break the render.
            }
        },
    };
};

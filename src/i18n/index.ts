import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { useStore } from '../store/useStore';
import en from './locales/en.json';
import type { SupportedLanguage } from './languages';
// Re-export the locale constant/type from the zero-import leaf module. Consumers
// may import from here, but anything in the store layer must import from
// `./languages` directly to keep the boot cycle broken.
export { SUPPORTED_LANGUAGES, type SupportedLanguage } from './languages';

export const defaultNS = 'translation';

// The settings store uses zustand `persist` over localStorage, whose rehydration
// is synchronous at creation, so `getState().language` here already reflects the
// persisted value. Some environments predate zustand's sync rehydrate, so guard
// with optional access and fall back to i18n's own detection.
//
// This runs at module evaluation. During the `i18n → useStore → …` cycle this
// module can be evaluated *before* `useStore`'s binding is initialised, so a
// bare reference would throw a TDZ `ReferenceError` and white-screen boot.
// Reading through a guarded thunk and treating any failure as "no persisted
// language" keeps the common path working without ever dereferencing an
// uninitialised binding.
let persistedLanguage: SupportedLanguage | undefined;
try {
    persistedLanguage = useStore?.getState?.().language;
} catch {
    // `useStore` not initialised yet (module cycle) — fall back to 'en'.
}

// Development-only guard for missing keys. Typed keys already turn a missing
// key into a `tsc` error at literal call sites, but types cannot see dynamic
// keys (`t(someVariable)`) or a key that was removed from the catalogue while a
// non-literal reference still points at it. In dev, surface those loudly;
// production behaviour is unchanged. `warned` dedupes so a missing key warns
// once, not on every render.
const warned = new Set<string>();
const parseMissingKeyHandler = import.meta.env.DEV
    ? (key: string): string => {
        if (!warned.has(key)) {
            warned.add(key);
            console.warn(`[i18n] missing key: ${key}`);
        }
        return `⟦missing:${key}⟧`;
    }
    : undefined;

i18n.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: persistedLanguage ?? 'en',
    fallbackLng: 'en',
    defaultNS,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    ...(parseMissingKeyHandler ? { parseMissingKeyHandler } : {}),
});

export default i18n;

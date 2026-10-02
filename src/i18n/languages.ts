/**
 * The single source of truth for locales the app supports.
 *
 * This module is a deliberately dependency-free leaf: it must never import
 * anything that (directly or transitively) imports the store. The store's
 * preference validators read `SUPPORTED_LANGUAGES`, and `src/i18n/index.ts`
 * imports the store to pick up the persisted language — importing the constant
 * from `./index` would create a cycle
 * (`preferenceValidation → i18n → useStore → legacyStorage → preferenceValidation`)
 * that dereferences an uninitialised `const` during module evaluation and
 * white-screens the app.
 *
 * `en` is the only catalogue shipped today; adding a locale is a one-line
 * addition here plus its `resources` entry and `languageOptions` label.
 *
 * Load-bearing: the persisted `language` is validated against this list (see
 * `preferenceValidation.ts`) so an unsupported BCP-47 tag can never reach
 * `Intl.RelativeTimeFormat` in `BottomBar` and crash the render.
 */
export const SUPPORTED_LANGUAGES = ['en'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

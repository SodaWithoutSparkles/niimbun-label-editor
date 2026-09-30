import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { useStore } from '../store/useStore';
import en from './locales/en.json';

export const defaultNS = 'translation';

// The settings store uses zustand `persist` over localStorage, whose rehydration
// is synchronous at creation, so `getState().language` here already reflects the
// persisted value. Some environments predate zustand's sync rehydrate, so guard
// with optional access and fall back to i18n's own detection.
const persistedLanguage = useStore.getState?.().language;

i18n.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: persistedLanguage ?? 'en',
    fallbackLng: 'en',
    defaultNS,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

export default i18n;

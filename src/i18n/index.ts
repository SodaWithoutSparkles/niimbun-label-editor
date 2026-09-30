import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

export const defaultNS = 'translation';

i18n.use(initReactI18next).init({
    resources: { en: { translation: en } },
    lng: 'en',
    fallbackLng: 'en',
    defaultNS,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
});

export default i18n;

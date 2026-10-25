import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en/common.json';

// English only for now. Add `src/locales/hi/common.json` and register it here to ship Hindi (P2).
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { common: en } },
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export default i18n;

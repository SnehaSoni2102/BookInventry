import i18n from 'i18next';
import { getLocales } from 'expo-localization';
import { initReactI18next } from 'react-i18next';

// English only for now; add resources for 'hi' (and others) here to ship another language.
void i18n.use(initReactI18next).init({
  lng: getLocales()[0]?.languageCode === 'hi' ? 'en' : 'en',
  fallbackLng: 'en',
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});

export default i18n;

import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; appUrl?: string };

/** e.g. https://books.example.org/api/v1 (set per EAS build profile via EXPO_PUBLIC_API_URL). */
export const API_URL = extra.apiUrl ?? 'https://books.example.org/api/v1';
export const APP_URL = extra.appUrl ?? 'https://books.example.org';
/** Socket.IO connects to the server origin; the path (/rt/socket.io) is added by api-client. */
export const RT_URL = APP_URL;

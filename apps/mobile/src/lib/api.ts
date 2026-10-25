import { createApi, createApiClient } from '@bookstall/api-client';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

const REFRESH_KEY = 'bookstall.refresh';

/** Access token: memory only. Refresh token: the device keystore (only while the phone is unlocked). */
let accessToken: string | null = null;
let onLogout: () => void = () => {};
const listeners = new Set<() => void>();

export const tokenStore = {
  get: () => accessToken,
  set: (t: string | null) => {
    if (t === accessToken) return;
    accessToken = t;
    listeners.forEach((l) => l());
  },
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  setLogoutHandler: (fn: () => void) => {
    onLogout = fn;
  },
};

export const refreshStore = {
  get: () => SecureStore.getItemAsync(REFRESH_KEY),
  set: (t: string) => SecureStore.setItemAsync(REFRESH_KEY, t, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  clear: () => SecureStore.deleteItemAsync(REFRESH_KEY),
};

export const api = createApi(
  createApiClient({
    baseUrl: API_URL,
    platform: 'mobile',
    getAccessToken: () => accessToken,
    setAccessToken: (t) => tokenStore.set(t),
    getRefreshToken: () => refreshStore.get(),
    // the server rotates the refresh token on every refresh; keep the newest one
    onSession: (res) => {
      if (res.refreshToken) void refreshStore.set(res.refreshToken);
    },
    onLogout: () => onLogout(),
  }),
);

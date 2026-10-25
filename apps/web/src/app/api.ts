import { createApi, createApiClient } from '@bookstall/api-client';
import { API_URL } from './env';

/** The access token lives only in memory; the refresh token is an httpOnly cookie. */
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

export const api = createApi(
  createApiClient({
    baseUrl: API_URL,
    platform: 'web',
    getAccessToken: () => accessToken,
    setAccessToken: (t) => tokenStore.set(t),
    onLogout: () => onLogout(),
  }),
);

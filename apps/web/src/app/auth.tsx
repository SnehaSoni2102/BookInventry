import { useMe } from '@bookstall/api-client';
import { can as canDo, type ChangePasswordBody, type LoginResponse, type MeResponse, type Permission } from '@bookstall/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { notifications } from '@mantine/notifications';
import { api, tokenStore } from './api';

export type AuthStatus = 'loading' | 'anon' | 'authed';

interface AuthValue {
  status: AuthStatus;
  me: MeResponse | undefined;
  accessToken: string | null;
  login: (username: string, password: string) => Promise<LoginResponse>;
  logout: (opts?: { reason?: string }) => Promise<void>;
  changePassword: (body: ChangePasswordBody) => Promise<void>;
  can: (permission: Permission) => boolean;
}

const Ctx = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

export const usePermission = (p: Permission) => useAuth().can(p);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const token = useSyncExternalStore(tokenStore.subscribe, tokenStore.get);
  const [bootstrapped, setBootstrapped] = useState(false);
  const meQ = useMe(Boolean(token));

  // On load, trade the httpOnly refresh cookie for an access token (silent sign-in).
  useEffect(() => {
    let cancelled = false;
    void api.client.refresh().finally(() => !cancelled && setBootstrapped(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const localLogout = useCallback(() => {
    tokenStore.set(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    tokenStore.setLogoutHandler(localLogout);
  }, [localLogout]);

  const logout = useCallback(
    async (opts?: { reason?: string }) => {
      await api.auth.logout().catch(() => undefined);
      localLogout();
      if (opts?.reason) notifications.show({ title: 'Signed out', message: opts.reason, color: 'yellow' });
    },
    [localLogout],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.auth.login({ username, password, client: 'web' });
      tokenStore.set(res.accessToken);
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      return res;
    },
    [qc],
  );

  const changePassword = useCallback(
    async (body: ChangePasswordBody) => {
      const res = await api.auth.changePassword(body);
      tokenStore.set(res.accessToken);
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    [qc],
  );

  const me = meQ.data;
  const status: AuthStatus = !bootstrapped ? 'loading' : !token ? 'anon' : me ? 'authed' : meQ.isError ? 'anon' : 'loading';

  // A rejected /auth/me with a token means the session is no longer valid.
  useEffect(() => {
    if (token && meQ.isError && bootstrapped) localLogout();
  }, [token, meQ.isError, bootstrapped, localLogout]);

  // Shared stall laptops lock themselves after a period without input (setting session.autoLockMinutes).
  const lockMinutes = me?.settings.autoLockMinutes ?? 0;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (status !== 'authed' || !lockMinutes) return;
    const arm = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void logout({ reason: `Locked after ${lockMinutes} minutes without activity` }), lockMinutes * 60_000);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [status, lockMinutes, logout]);

  const can = useCallback((p: Permission) => (me ? canDo(me.user, p) : false), [me]);
  const value = useMemo<AuthValue>(() => ({ status, me, accessToken: token, login, logout, changePassword, can }), [status, me, token, login, logout, changePassword, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

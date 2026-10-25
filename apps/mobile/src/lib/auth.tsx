import { useMe } from '@bookstall/api-client';
import { can as canDo, type ChangePasswordBody, type LoginResponse, type MeResponse, type Permission } from '@bookstall/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api, refreshStore, tokenStore } from './api';

export type AuthStatus = 'loading' | 'anon' | 'authed';

interface AuthValue {
  status: AuthStatus;
  me: MeResponse | undefined;
  accessToken: string | null;
  login: (username: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  changePassword: (body: ChangePasswordBody) => Promise<void>;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<AuthValue | null>(null);
export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const token = useSyncExternalStore(tokenStore.subscribe, tokenStore.get);
  const [booted, setBooted] = useState(false);
  const meQ = useMe(Boolean(token));

  // App start: trade the stored refresh token for an access token.
  useEffect(() => {
    let cancelled = false;
    void api.client.refresh().finally(() => !cancelled && setBooted(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const localLogout = useCallback(async () => {
    tokenStore.set(null);
    await refreshStore.clear();
    qc.clear();
  }, [qc]);
  useEffect(() => tokenStore.setLogoutHandler(() => void localLogout()), [localLogout]);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.auth.login({ username, password, client: 'mobile' });
      if (res.refreshToken) await refreshStore.set(res.refreshToken);
      tokenStore.set(res.accessToken);
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      return res;
    },
    [qc],
  );

  const logout = useCallback(async () => {
    const rt = await refreshStore.get();
    await api.auth.logout(rt ?? undefined).catch(() => undefined);
    await localLogout();
  }, [localLogout]);

  const changePassword = useCallback(
    async (body: ChangePasswordBody) => {
      const res = await api.auth.changePassword(body);
      if (res.refreshToken) await refreshStore.set(res.refreshToken);
      tokenStore.set(res.accessToken);
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    [qc],
  );

  useEffect(() => {
    if (token && meQ.isError && booted) void localLogout();
  }, [token, meQ.isError, booted, localLogout]);

  const me = meQ.data;
  const status: AuthStatus = !booted ? 'loading' : !token ? 'anon' : me ? 'authed' : meQ.isError ? 'anon' : 'loading';
  const can = useCallback((p: Permission) => (me ? canDo(me.user, p) : false), [me]);
  const value = useMemo<AuthValue>(() => ({ status, me, accessToken: token, login, logout, changePassword, can }), [status, me, token, login, logout, changePassword, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

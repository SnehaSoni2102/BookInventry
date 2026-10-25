import { useRealtime } from '@bookstall/api-client';
import { focusManager, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './auth';
import { RT_URL } from './config';

/** Live updates while signed in; refetch active queries whenever the app returns to the foreground. */
export function RealtimeBridge({ children }: { children: ReactNode }) {
  const { accessToken, status, logout } = useAuth();
  const qc = useQueryClient();
  useRealtime({ url: RT_URL, token: status === 'authed' ? accessToken : null, queryClient: qc, onRevoked: () => void logout() });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
    return () => sub.remove();
  }, []);
  return <>{children}</>;
}

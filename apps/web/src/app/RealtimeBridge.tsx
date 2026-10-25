import { useRealtime } from '@bookstall/api-client';
import { Indicator, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { useAuth } from './auth';
import { RT_URL } from './env';

const StatusCtx = createContext<'connecting' | 'connected' | 'disconnected'>('disconnected');
export const useRealtimeStatus = () => useContext(StatusCtx);

/** Keeps the socket open while signed in; every event just invalidates cached queries. */
export function RealtimeBridge({ children }: { children: ReactNode }) {
  const { accessToken, status, logout } = useAuth();
  const queryClient = useQueryClient();
  const state = useRealtime({
    url: RT_URL,
    token: status === 'authed' ? accessToken : null,
    queryClient,
    onToast: ({ event, payload }) => {
      if (event === 'shelf.space.low') notifications.show({ color: 'yellow', title: 'Shelf space is running low', message: `${String(payload.code ?? 'A genre')} is ${String(payload.percentFull)}% full` });
    },
    onRevoked: () => void logout({ reason: 'Your session was ended by an administrator.' }),
  });
  return <StatusCtx.Provider value={state}>{children}</StatusCtx.Provider>;
}

export function ConnectionIndicator() {
  const s = useRealtimeStatus();
  const color = s === 'connected' ? 'green' : s === 'connecting' ? 'yellow' : 'red';
  const label = s === 'connected' ? 'Live updates on' : s === 'connecting' ? 'Connecting…' : 'Offline: live updates paused';
  return (
    <Tooltip label={label}>
      <Indicator color={color} size={10} processing={s === 'connecting'} position="middle-center" aria-label={label} role="status" withBorder>
        <span style={{ display: 'inline-block', width: 14, height: 14 }} />
      </Indicator>
    </Tooltip>
  );
}

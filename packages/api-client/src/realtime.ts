import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { qk } from './keys.js';

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

export interface RealtimeOptions {
  /** Origin of the server, e.g. "https://books.example.org" (empty string = same origin in the browser). */
  url: string;
  token: string | null;
  queryClient: QueryClient;
  /** Socket.IO path (the server uses /rt/socket.io so a single `/rt/*` proxy rule covers it). */
  path?: string;
  onToast?: (e: { event: string; payload: Record<string, unknown> }) => void;
  onRevoked?: () => void;
}

/** Event → query keys to refetch. Payloads are tiny; the truth always comes from a normal REST call. */
export function invalidationsFor(event: string, payload: Record<string, unknown>) {
  switch (event) {
    case 'sale.created':
    case 'sale.voided':
      return [qk.sales.all(), qk.titles.all(), qk.copies.all(), qk.stalls.all(), qk.dashboard()];
    case 'inventory.changed':
      return [qk.titles.all(), qk.copies.all(), qk.stalls.all(), qk.dashboard(), qk.shelves.map()];
    case 'stall.updated':
      return [qk.stalls.all(), qk.me(), qk.dashboard()];
    case 'title.updated':
      return [typeof payload.titleId === 'string' ? qk.titles.one(payload.titleId) : qk.titles.all(), qk.titles.all()];
    case 'import.updated':
      return [typeof payload.jobId === 'string' ? qk.imports.one(payload.jobId) : qk.imports.all(), qk.imports.all()];
    case 'shelf.space.low':
      return [qk.shelves.map(), qk.dashboard()];
    default:
      return [];
  }
}

const EVENTS = ['sale.created', 'sale.voided', 'inventory.changed', 'stall.updated', 'title.updated', 'shelf.space.low', 'import.updated'] as const;

export function connectRealtime(opts: RealtimeOptions, onStatus: (s: RealtimeStatus) => void): () => void {
  if (!opts.token) return () => {};
  const socket: Socket = io(opts.url, {
    path: opts.path ?? '/rt/socket.io',
    auth: { token: opts.token },
    transports: ['websocket', 'polling'],
    reconnectionDelayMax: 10_000,
  });
  onStatus('connecting');
  socket.on('connect', () => onStatus('connected'));
  socket.on('disconnect', () => onStatus('disconnected'));
  socket.on('connect_error', () => onStatus('disconnected'));
  for (const event of EVENTS) {
    socket.on(event, (payload: Record<string, unknown> = {}) => {
      for (const key of invalidationsFor(event, payload)) void opts.queryClient.invalidateQueries({ queryKey: key });
      opts.onToast?.({ event, payload });
    });
  }
  socket.on('session.revoked', () => opts.onRevoked?.());
  return () => {
    socket.removeAllListeners();
    socket.disconnect();
  };
}

/** React hook: connects while there is an access token, reconnects when it changes. */
export function useRealtime(opts: Omit<RealtimeOptions, 'onToast' | 'onRevoked'> & Pick<RealtimeOptions, 'onToast' | 'onRevoked'>): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');
  const handlers = useRef({ onToast: opts.onToast, onRevoked: opts.onRevoked });
  handlers.current = { onToast: opts.onToast, onRevoked: opts.onRevoked };
  useEffect(() => {
    if (!opts.token) {
      setStatus('disconnected');
      return;
    }
    return connectRealtime(
      { ...opts, onToast: (e) => handlers.current.onToast?.(e), onRevoked: () => handlers.current.onRevoked?.() },
      setStatus,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.url, opts.token, opts.path, opts.queryClient]);
  return status;
}

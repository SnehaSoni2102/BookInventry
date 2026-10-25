import { formatMoney } from '@bookstall/shared';
import { useCallback, useMemo } from 'react';
import { useAuth } from './auth';

export function useFormat() {
  const { me } = useAuth();
  const s = me?.settings;
  const currency = s?.currency ?? 'INR';
  const locale = s?.locale ?? 'en-IN';
  const timezone = s?.timezone ?? 'Asia/Kolkata';
  const money = useCallback((m: number | null | undefined) => (m === null || m === undefined ? '—' : formatMoney(m, currency, locale)), [currency, locale]);
  const dateTime = useCallback((iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(locale, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }) : '—'), [locale, timezone]);
  const date = useCallback((iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(locale, { timeZone: timezone, dateStyle: 'medium' }) : '—'), [locale, timezone]);
  return useMemo(() => ({ money, dateTime, date }), [money, dateTime, date]);
}

export const CONDITION_LABEL: Record<string, string> = { NEW: 'New', LIKE_NEW: 'Like new', VERY_GOOD: 'Very good', GOOD: 'Good', FAIR: 'Fair', POOR: 'Poor' };
export const STATUS_LABEL: Record<string, string> = { IN_STOCK: 'In stock', AT_STALL: 'At stall', SOLD: 'Sold', WRITTEN_OFF: 'Written off' };

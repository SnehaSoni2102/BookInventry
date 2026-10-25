import { formatMoney } from '@bookstall/shared';
import { useCallback, useMemo } from 'react';
import { useAuth } from '../app/auth';

/** Money and dates formatted per the organisation's settings (INR / en-IN / Asia/Kolkata by default). */
export function useFormat() {
  const { me } = useAuth();
  const s = me?.settings;
  const currency = s?.currency ?? 'INR';
  const locale = s?.locale ?? 'en-IN';
  const timezone = s?.timezone ?? 'Asia/Kolkata';
  const money = useCallback((minor: number | null | undefined) => (minor === null || minor === undefined ? '—' : formatMoney(minor, currency, locale)), [currency, locale]);
  const dateTime = useCallback(
    (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(locale, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }) : '—'),
    [locale, timezone],
  );
  const date = useCallback(
    (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(locale, { timeZone: timezone, dateStyle: 'medium' }) : '—'),
    [locale, timezone],
  );
  return useMemo(() => ({ money, dateTime, date, currency, locale, timezone }), [money, dateTime, date, currency, locale, timezone]);
}

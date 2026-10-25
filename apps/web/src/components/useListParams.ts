import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List state (search text, filters, sort, page) lives in the URL: links can be shared, and the back button works.
 * Changing any filter resets to page 1.
 */
export function useListParams(defaults: Record<string, string> = {}) {
  const [sp, setSp] = useSearchParams();
  const get = useCallback((k: string) => sp.get(k) ?? defaults[k] ?? '', [sp, defaults]);
  const getAll = useCallback((k: string) => sp.getAll(k), [sp]);

  const set = useCallback(
    (patch: Record<string, string | string[] | number | null | undefined>, opts: { keepPage?: boolean } = {}) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            next.delete(k);
            if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
            else if (v !== null && v !== undefined && v !== '' && String(v) !== defaults[k]) next.set(k, String(v));
          }
          if (!opts.keepPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSp, defaults],
  );

  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1);
  const pageSize = Number(sp.get('pageSize') ?? defaults.pageSize ?? 25) || 25;
  return useMemo(() => ({ get, getAll, set, page, pageSize, sp }), [get, getAll, set, page, pageSize, sp]);
}

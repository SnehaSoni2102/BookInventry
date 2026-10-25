import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../app/auth';

export interface CartItem {
  copyId: string;
  code: string;
  title: string;
  condition: string;
  sellingPriceMinor: number;
  /** Where the book is at the moment of adding: shown so the seller can sanity-check. */
  locationCode: string | null;
  stallName: string | null;
}

interface CartValue {
  items: CartItem[];
  add: (item: CartItem) => 'added' | 'duplicate';
  remove: (copyId: string) => void;
  clear: () => void;
  has: (copyId: string) => boolean;
  totalMinor: number;
}

const Ctx = createContext<CartValue | null>(null);
export const useCart = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCart must be used inside <CartProvider>');
  return v;
};

const key = (userId: string | undefined) => `bookstall.cart.${userId ?? 'anon'}`;

function load(userId: string | undefined): CartItem[] {
  try {
    const raw = sessionStorage.getItem(key(userId));
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

/** The cart survives a page reload (sessionStorage) but not a new browser session. The server re-checks everything on submit. */
export function CartProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const userId = me?.user.id;
  // `ref` is the source of truth so add() can answer "added" / "duplicate" synchronously (a state updater runs later).
  const ref = useRef<CartItem[]>(load(userId));
  const [items, setItems] = useState<CartItem[]>(ref.current);
  const commit = useCallback((next: CartItem[]) => {
    ref.current = next;
    setItems(next);
  }, []);

  useEffect(() => commit(load(userId)), [userId, commit]);
  useEffect(() => {
    try {
      sessionStorage.setItem(key(userId), JSON.stringify(items));
    } catch {
      /* storage may be unavailable (private mode); the cart still works in memory */
    }
  }, [items, userId]);

  const add = useCallback(
    (item: CartItem): 'added' | 'duplicate' => {
      if (ref.current.some((c) => c.copyId === item.copyId)) return 'duplicate';
      commit([...ref.current, item]);
      return 'added';
    },
    [commit],
  );
  const remove = useCallback((copyId: string) => commit(ref.current.filter((c) => c.copyId !== copyId)), [commit]);
  const clear = useCallback(() => commit([]), [commit]);
  const value = useMemo<CartValue>(
    () => ({ items, add, remove, clear, has: (id) => items.some((i) => i.copyId === id), totalMinor: items.reduce((a, i) => a + i.sellingPriceMinor, 0) }),
    [items, add, remove, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export interface CartItem {
  copyId: string;
  code: string;
  title: string;
  condition: string;
  sellingPriceMinor: number;
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

/** In-memory cart. The server re-validates everything when the sale is submitted. */
export function CartProvider({ children }: { children: ReactNode }) {
  const ref = useRef<CartItem[]>([]);
  const [items, setItems] = useState<CartItem[]>([]);
  const commit = useCallback((next: CartItem[]) => {
    ref.current = next;
    setItems(next);
  }, []);
  const add = useCallback(
    (item: CartItem): 'added' | 'duplicate' => {
      if (ref.current.some((c) => c.copyId === item.copyId)) return 'duplicate';
      commit([...ref.current, item]);
      return 'added';
    },
    [commit],
  );
  const value = useMemo<CartValue>(
    () => ({
      items,
      add,
      remove: (id) => commit(ref.current.filter((c) => c.copyId !== id)),
      clear: () => commit([]),
      has: (id) => items.some((i) => i.copyId === id),
      totalMinor: items.reduce((a, i) => a + i.sellingPriceMinor, 0),
    }),
    [items, add, commit],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

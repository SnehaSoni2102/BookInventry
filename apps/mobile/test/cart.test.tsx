import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { CartProvider, useCart } from '../src/lib/cart';

const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;
const item = (n: number) => ({ copyId: `c${n}`, code: `BK000000${n}`, title: `Book ${n}`, condition: 'GOOD', sellingPriceMinor: n * 1000, locationCode: 'FIC-A01-001', stallName: null });

describe('cart', () => {
  it('adds books, reports duplicates synchronously, and totals', async () => {
    const { result } = await renderHook(() => useCart(), { wrapper });
    let first = '', dup = '';
    await act(async () => { first = result.current.add(item(1)); dup = result.current.add(item(1)); result.current.add(item(2)); });
    expect(first).toBe('added');
    expect(dup).toBe('duplicate');
    expect(result.current.items).toHaveLength(2);
    expect(result.current.totalMinor).toBe(3000);
  });

  it('removes and clears', async () => {
    const { result } = await renderHook(() => useCart(), { wrapper });
    await act(async () => { result.current.add(item(1)); result.current.add(item(2)); });
    await act(async () => result.current.remove('c1'));
    expect(result.current.items.map((i) => i.copyId)).toEqual(['c2']);
    await act(async () => result.current.clear());
    expect(result.current.items).toEqual([]);
  });
});

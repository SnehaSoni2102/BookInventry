import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let userId = 'user-1';
vi.mock('../src/app/auth', () => ({ useAuth: () => ({ me: { user: { id: userId } } }) }));

const { CartProvider, useCart } = await import('../src/lib/cart');
const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;
const item = (n: number) => ({ copyId: `c${n}`, code: `BK000000${n}`, title: `Book ${n}`, condition: 'GOOD', sellingPriceMinor: n * 1000, locationCode: 'FIC-A01-001', stallName: null });

describe('cart', () => {
  beforeEach(() => {
    sessionStorage.clear();
    userId = 'user-1';
  });

  it('adds, totals, and rejects duplicates', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    let r1: string | undefined, r2: string | undefined;
    act(() => { r1 = result.current.add(item(1)); });
    act(() => { r2 = result.current.add(item(1)); });
    act(() => { result.current.add(item(2)); });
    expect(r1).toBe('added');
    expect(r2).toBe('duplicate');
    expect(result.current.items).toHaveLength(2);
    expect(result.current.totalMinor).toBe(3000);
    expect(result.current.has('c2')).toBe(true);
  });

  it('removes and clears', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => { result.current.add(item(1)); result.current.add(item(2)); });
    act(() => result.current.remove('c1'));
    expect(result.current.items.map((i) => i.copyId)).toEqual(['c2']);
    act(() => result.current.clear());
    expect(result.current.items).toEqual([]);
  });

  it('survives a reload (sessionStorage) and is kept per user', () => {
    const first = renderHook(() => useCart(), { wrapper });
    act(() => { first.result.current.add(item(1)); });
    first.unmount();
    expect(renderHook(() => useCart(), { wrapper }).result.current.items).toHaveLength(1);
    userId = 'user-2';
    expect(renderHook(() => useCart(), { wrapper }).result.current.items).toHaveLength(0);
  });

  it('works when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => { result.current.add(item(1)); });
    expect(result.current.items).toHaveLength(1);
    spy.mockRestore();
  });
});

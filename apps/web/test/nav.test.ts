import { can as canDo, type Role } from '@bookstall/shared';
import { describe, expect, it } from 'vitest';
import { visibleNav } from '../src/app/nav';
import { strength } from '../src/features/auth/ChangePasswordPage';

const labels = (role: Role) => visibleNav((p) => canDo({ role }, p)).map((n) => n.labelKey);

describe('navigation per role', () => {
  it('admin sees everything', () => {
    expect(labels('ADMIN')).toEqual(expect.arrayContaining(['nav.dashboard', 'nav.scan', 'nav.addBooks', 'nav.inventory', 'nav.stalls', 'nav.sales', 'nav.labels', 'nav.import', 'nav.shelves', 'nav.genres', 'nav.users', 'nav.settings', 'nav.audit']));
    expect(labels('ADMIN')).not.toContain('nav.myStall');
    expect(labels('ADMIN')).not.toContain('nav.mySales');
  });
  it('inventory staff: no sales, users, import, settings or audit', () => {
    const l = labels('INVENTORY_STAFF');
    expect(l).toEqual(expect.arrayContaining(['nav.addBooks', 'nav.inventory', 'nav.stalls', 'nav.labels', 'nav.shelves']));
    for (const hidden of ['nav.sales', 'nav.mySales', 'nav.users', 'nav.import', 'nav.settings', 'nav.audit', 'nav.genres']) expect(l).not.toContain(hidden);
  });
  it('stall manager: my stall + my sales + scan only', () => {
    expect(labels('STALL_MANAGER')).toEqual(['nav.dashboard', 'nav.scan', 'nav.myStall', 'nav.mySales']);
  });
});

describe('password strength meter', () => {
  it('scores length, mixed case and symbols', () => {
    expect(strength('abc')).toBe(0);
    expect(strength('abcdefgh')).toBe(1);
    expect(strength('abcdefghijkl')).toBe(2);
    expect(strength('Abcdefghijkl')).toBe(3);
    expect(strength('Abcdefghij1!')).toBe(4);
  });
});

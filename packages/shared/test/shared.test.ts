import { describe, expect, it } from 'vitest';
import {
  ROLE_PERMISSIONS, PERMISSIONS, Role, can, parseScan, isValidIsbn13, isValidIsbn10, isbn10To13,
  isbn13To10, formatMoney, parseMoneyToMinor, formatLocation, titleSort, authorSort, normalizeText,
  searchText,
} from '../src';

describe('parseScan', () => {
  it('parses copy codes and URLs on any host', () => {
    expect(parseScan('bk0000123')).toEqual({ kind: 'copy', code: 'BK0000123' });
    expect(parseScan('https://old.example.org/b/BK0000123')).toEqual({ kind: 'copy', code: 'BK0000123' });
    expect(parseScan('https://x.org/b/BK0000123/')).toEqual({ kind: 'copy', code: 'BK0000123' });
    expect(parseScan('  BK0000123\r\n')).toEqual({ kind: 'copy', code: 'BK0000123' });
  });
  it('parses ISBNs, including ISBN-10 and add-ons', () => {
    expect(parseScan('9780143127550')).toEqual({ kind: 'isbn', isbn13: '9780143127550' });
    expect(parseScan('978-0-14-312755-0')).toEqual({ kind: 'isbn', isbn13: '9780143127550' });
    expect(parseScan('0306406152')).toEqual({ kind: 'isbn', isbn13: '9780306406157' });
    expect(parseScan('978030640615751499')).toEqual({ kind: 'isbn', isbn13: '9780306406157' });
  });
  it('rejects bad checksums and junk', () => {
    expect(parseScan('9780143127551').kind).toBe('unknown');
    expect(parseScan('hello').kind).toBe('unknown');
    expect(parseScan('https://x.org/other').kind).toBe('unknown');
  });
});

describe('isbn', () => {
  it('validates and converts', () => {
    expect(isValidIsbn13('9780306406157')).toBe(true);
    expect(isValidIsbn13('9780306406158')).toBe(false);
    expect(isValidIsbn10('080442957X')).toBe(true);
    expect(isbn10To13('0306406152')).toBe('9780306406157');
    expect(isbn13To10('9780306406157')).toBe('0306406152');
  });
});

describe('money', () => {
  it('formats and parses', () => {
    expect(formatMoney(15000)).toBe('₹150');
    expect(formatMoney(15050)).toBe('₹150.50');
    expect(formatMoney(123456700)).toBe('₹12,34,567');
    expect(parseMoneyToMinor('150.50')).toBe(15050);
    expect(parseMoneyToMinor('₹1,500')).toBe(150000);
    expect(parseMoneyToMinor('150.5')).toBe(15050);
    expect(parseMoneyToMinor('-1')).toBeNull();
    expect(parseMoneyToMinor('1.234')).toBeNull();
    expect(parseMoneyToMinor('abc')).toBeNull();
  });
});

describe('location and normalize', () => {
  it('formats location', () => expect(formatLocation('FIC', 'A', 3, 17)).toBe('FIC-A03-017'));
  it('normalizes text', () => {
    expect(normalizeText('Café – Déjà Vu!')).toBe('cafe deja vu');
    expect(normalizeText('हिन्दी किताब')).toBe('हिन्दी किताब');
    expect(titleSort('The God of Small Things')).toBe('god of small things');
    expect(titleSort('A')).toBe('a');
    expect(authorSort(['J. K. Rowling'])).toBe('rowling j k');
    expect(authorSort(['Rowling, J. K.'])).toBe('rowling j k');
    expect(authorSort([])).toBe('');
    expect(searchText({ title: 'X', authors: ['Y Z'], isbn13: '9780143127550' })).toBe('x y z 9780143127550');
  });
});

describe('permissions matrix', () => {
  it('only references known permissions', () => {
    for (const role of Role.values) for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
  });
  it('matches the plan', () => {
    expect(can({ role: 'ADMIN' }, 'user.manage')).toBe(true);
    expect(can({ role: 'INVENTORY_STAFF' }, 'stall.checkin')).toBe(true);
    expect(can({ role: 'INVENTORY_STAFF' }, 'sale.read.all')).toBe(false);
    expect(can({ role: 'INVENTORY_STAFF' }, 'copy.writeoff')).toBe(false);
    expect(can({ role: 'STALL_MANAGER' }, 'stall.checkout')).toBe(false);
    expect(can({ role: 'STALL_MANAGER' }, 'sale.create.stall')).toBe(true);
    expect(can({ role: 'STALL_MANAGER' }, 'sale.create.central')).toBe(false);
    expect(can({ role: 'STALL_MANAGER' }, 'inventory.read')).toBe(false);
    expect(can(null, 'inventory.read')).toBe(false);
  });
});

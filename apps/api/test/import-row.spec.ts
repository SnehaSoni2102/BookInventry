import { describe, expect, it } from 'vitest';
import type { CatalogLookupResult } from '@bookstall/shared';
import { buildGenreIndex, parseCondition, validateImportRow, wantsLookup } from '../src/modules/imports/import-row.js';

const genres = buildGenreIndex([
  { id: 'g-fic', name: 'Fiction (General & Literary)', code: 'FIC' },
  { id: 'g-hin', name: 'Hindi & Regional Literature', code: 'HIN' },
  { id: 'g-cafe', name: 'Café & Cooking', code: 'CKG' },
]);
const ok = { title: 'T', genre: 'FIC', condition: 'GOOD', selling_price: '150' };
const run = (raw: Parameters<typeof validateImportRow>[0], lookup?: CatalogLookupResult | null, lookupFailed = false) =>
  validateImportRow(raw, { genres, lookup, lookupFailed });
const fields = (r: ReturnType<typeof run>, level: 'error' | 'warning') => r.messages.filter((m) => m.level === level).map((m) => m.field);

describe('validateImportRow', () => {
  it('accepts a minimal row and converts rupees to paise', () => {
    const r = run({ ...ok, original_price: '399.50', quantity: '3', authors: 'A; B ;C', donor: 'Mrs Rao' });
    expect(r.status).toBe('VALID');
    expect(r.normalized).toMatchObject({
      quantity: 3, lookup: 'NONE',
      title: { title: 'T', authors: ['A', 'B', 'C'], genreId: 'g-fic' },
      copy: { condition: 'GOOD', sellingPriceMinor: 15000, originalPriceMinor: 39950, donorName: 'Mrs Rao' },
    });
  });

  it('parses conditions leniently', () => {
    for (const [text, want] of [['like new', 'LIKE_NEW'], ['Very-Good', 'VERY_GOOD'], ['VERY_GOOD', 'VERY_GOOD'], ['NEW', 'NEW'], [' poor ', 'POOR']]) {
      expect(parseCondition(text)).toBe(want);
    }
    expect(parseCondition('mint')).toBeNull();
    expect(fields(run({ ...ok, condition: 'mint' }), 'error')).toEqual(['condition']);
  });

  it('matches genres by name or code, ignoring case and accents', () => {
    expect(run({ ...ok, genre: 'fiction (general & literary)' }).normalized?.title?.genreId).toBe('g-fic');
    expect(run({ ...ok, genre: 'hin' }).normalized?.title?.genreId).toBe('g-hin');
    expect(run({ ...ok, genre: 'Cafe & Cooking' }).normalized?.title?.genreId).toBe('g-cafe');
    const bad = run({ ...ok, genre: 'Cooking' });
    expect(bad.status).toBe('ERROR');
    expect(bad.messages[0]).toMatchObject({ field: 'genre', message: expect.stringContaining('Unknown genre "Cooking"') });
  });

  it('reports every problem on a row, not just the first', () => {
    const r = run({ isbn: '123', condition: 'mint', selling_price: 'abc', quantity: '0' });
    expect(fields(r, 'error').sort()).toEqual(['condition', 'genre', 'isbn', 'quantity', 'selling_price', 'title'].sort());
    expect(r.normalized).toBeNull();
  });

  it('requires condition, selling price, and an ISBN or a title', () => {
    expect(fields(run({ title: 'T', genre: 'FIC' }), 'error').sort()).toEqual(['condition', 'selling_price']);
    expect(fields(run({ genre: 'FIC', condition: 'GOOD', selling_price: '1' }), 'error')).toEqual(['title']);
  });

  it('checks quantity and prices', () => {
    for (const q of ['0', '201', '1.5', 'x']) expect(fields(run({ ...ok, quantity: q }), 'error')).toEqual(['quantity']);
    expect(run({ ...ok, quantity: '200' }).status).toBe('VALID');
    expect(fields(run({ ...ok, selling_price: '-5' }), 'error')).toEqual(['selling_price']);
    expect(run({ ...ok, selling_price: '0' }).status).toBe('VALID'); // free books are allowed
    expect(run({ ...ok, selling_price: '₹1,500' }).normalized?.copy.sellingPriceMinor).toBe(150000);
  });

  it('only warns (and ignores the value) for bad optional fields', () => {
    const r = run({ ...ok, original_price: 'n/a', published_year: '1066', language: 'Klingon', cover_url: 'ftp://x' });
    expect(r.status).toBe('WARNING');
    expect(fields(r, 'warning').sort()).toEqual(['cover_url', 'language', 'original_price', 'published_year']);
    expect(r.normalized?.title).not.toHaveProperty('coverUrl');
    expect(run({ ...ok, language: 'Hindi', published_year: '2015' }).normalized?.title).toMatchObject({ language: 'hi', publishedYear: 2015 });
  });

  it('warns when the selling price is above the MRP', () => {
    expect(run({ ...ok, original_price: '100', selling_price: '150' }).status).toBe('WARNING');
  });

  it('normalises ISBN-10 to ISBN-13 and derives the ISBN-10', () => {
    const r = run({ ...ok, isbn: '0-306-40615-2' });
    expect(r.normalized?.title).toMatchObject({ isbn13: '9780306406157', isbn10: '0306406152' });
    expect(r.dedupeKey).toBe('9780306406157|GOOD|15000');
  });

  const found: CatalogLookupResult = {
    inInventory: false, found: true, source: 'OPEN_LIBRARY', suggestedGenreId: 'g-fic',
    metadata: {
      isbn13: '9780306406157', isbn10: '0306406152', title: 'Looked Up', subtitle: 'Sub', authors: ['L. Author'], publisher: 'Pub',
      publishedYear: 2001, language: 'en', pageCount: 100, summary: 'Summary', subjects: ['Fiction'], coverUrl: 'https://c/x.jpg', externalIds: { openLibrary: 'OL1' },
    },
  };

  it('fills blanks from a lookup, suggests a genre with a warning, and lets typed values win', () => {
    const r = run({ isbn: '9780306406157', condition: 'good', selling_price: '99', title: 'My Title' }, found);
    expect(r.status).toBe('WARNING');
    expect(r.messages).toEqual([expect.objectContaining({ level: 'warning', field: 'genre' })]);
    expect(r.normalized).toMatchObject({
      lookup: 'OPEN_LIBRARY',
      title: { title: 'My Title', authors: ['L. Author'], genreId: 'g-fic', publisher: 'Pub', pageCount: 100, summary: 'Summary', coverUrl: 'https://c/x.jpg', subjects: ['Fiction'] },
    });
    // an explicit genre means no warning
    expect(run({ isbn: '9780306406157', condition: 'good', selling_price: '99', genre: 'HIN' }, found).status).toBe('VALID');
  });

  it('errors when a lookup finds nothing and the row has no title/genre', () => {
    const miss: CatalogLookupResult = { inInventory: false, found: false };
    const r = run({ isbn: '9780306406157', condition: 'good', selling_price: '99' }, miss);
    expect(fields(r, 'error').sort()).toEqual(['genre', 'title']);
    expect(fields(run({ isbn: '9780306406157', condition: 'good', selling_price: '99' }, null, true), 'warning')).toEqual(['isbn']);
  });

  it('adds copies to an existing title without touching its metadata or needing a genre', () => {
    const local: CatalogLookupResult = { inInventory: true, titleId: 'title-1', found: true, source: 'LOCAL', metadata: found.metadata };
    const r = run({ isbn: '9780306406157', condition: 'fair', selling_price: '40' }, local);
    expect(r.status).toBe('VALID');
    expect(r.normalized).toMatchObject({ titleId: 'title-1', title: null, lookup: 'LOCAL', copy: { condition: 'FAIR', sellingPriceMinor: 4000 } });
  });

  it('shortens very long summaries with a warning', () => {
    const r = run({ ...ok, summary: 'x'.repeat(5000) });
    expect(r.status).toBe('WARNING');
    expect(r.normalized?.title?.summary).toHaveLength(4000);
  });
});

describe('wantsLookup', () => {
  it('asks for a lookup only when there is a valid ISBN and something to fill in', () => {
    expect(wantsLookup({ isbn: '9780306406157', condition: 'GOOD' })).toBe('9780306406157');
    expect(wantsLookup({ isbn: '0-306-40615-2' })).toBe('9780306406157');
    expect(wantsLookup({ isbn: 'junk' })).toBeNull();
    expect(wantsLookup({ title: 'x' })).toBeNull();
    expect(wantsLookup({ isbn: '9780306406157', title: 't', authors: 'a', genre: 'g', summary: 's', cover_url: 'u' })).toBeNull();
  });
});

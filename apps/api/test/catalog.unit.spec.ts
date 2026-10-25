import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { descriptionOf, mapOpenLibraryBook, mapOpenLibrarySearch } from '../src/modules/catalog/openlibrary.provider.js';
import { cleanGoogleCover, mapGoogleVolume } from '../src/modules/catalog/googlebooks.provider.js';
import { mergeMetadata } from '../src/modules/catalog/merge.js';
import { suggestGenre, type GenreWithKeywords } from '../src/modules/catalog/genre-suggest.js';
import { cleanSummary, normalizeLanguage, yearFrom } from '../src/modules/catalog/text.js';
import { ProviderGate, ProviderUnavailableError } from '../src/modules/catalog/provider-gate.js';
import { isPrivateAddress } from '../src/modules/covers/safe-fetch.js';

const fx = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('Open Library mapper (recorded fixtures)', () => {
  const book = fx('ol-books-9780143127550.json')['ISBN:9780143127550'];
  it('maps the data API', () => {
    const m = mapOpenLibraryBook('9780143127550', book)!;
    expect(m).toMatchObject({
      isbn13: '9780143127550', isbn10: '0143127551', title: 'Everything I Never Told You',
      authors: ['Celeste Ng'], publisher: 'Penguin Books', publishedYear: 2015, pageCount: 297,
      coverUrl: 'https://covers.openlibrary.org/b/id/12178284-L.jpg', externalIds: { openLibrary: 'OL26389863M' },
    });
    expect(m.subjects).toContain('Fiction');
  });
  it('reads the work description (string or {value})', () => {
    expect(descriptionOf(fx('ol-work-OL17295077W.json'))).toMatch(/^Lydia is dead/);
    expect(descriptionOf({ description: 'plain' })).toBe('plain');
    expect(descriptionOf({})).toBeNull();
  });
  it('maps search results and picks a valid ISBN-13', () => {
    const hits = mapOpenLibrarySearch(fx('ol-search-god-of-small-things.json').docs);
    expect(hits[0]).toMatchObject({ source: 'OPEN_LIBRARY', title: 'The God of Small Things' });
    expect(hits[0]!.isbn13).toMatch(/^97[89]\d{10}$/);
    expect(hits[0]!.coverUrl).toMatch(/covers\.openlibrary\.org/);
  });
});

describe('Google Books mapper', () => {
  const vol = fx('gb-isbn-9780143127550.json').items[0];
  it('maps volume info, cleans the cover and splits categories', () => {
    const m = mapGoogleVolume(vol)!;
    expect(m.summary).toMatch(/^Lydia is dead\./);
    expect(m.summary).not.toMatch(/<|>/);
    expect(m.subjects).toEqual(expect.arrayContaining(['Fiction / Literary', 'Fiction', 'Literary']));
    expect(m.coverUrl).toBe('https://books.google.com/books/content?id=Fq9ODwAAQBAJ&printsec=frontcover&img=1&zoom=1&source=gbs_api');
    expect(m).toMatchObject({ isbn13: '9780143127550', isbn10: '0143127551', publishedYear: 2015, language: 'en', externalIds: { googleBooks: 'Fq9ODwAAQBAJ' } });
  });
  it('cleanGoogleCover handles missing', () => expect(cleanGoogleCover(undefined)).toBeNull());
});

describe('merge', () => {
  const ol = mapOpenLibraryBook('9780143127550', fx('ol-books-9780143127550.json')['ISBN:9780143127550'])!;
  const gb = mapGoogleVolume(fx('gb-isbn-9780143127550.json').items[0])!;
  it('prefers OL bibliographic fields and Google description/categories', () => {
    const m = mergeMetadata(ol, gb)!;
    expect(m.pageCount).toBe(297);
    expect(m.publisher).toBe('Penguin Books');
    expect(m.summary).toBe(gb.summary);
    expect(m.subjects[0]).toBe('Fiction / Literary');
    expect(m.subjects).toContain('Grief');
    expect(m.coverUrl).toBe(ol.coverUrl);
    expect(m.externalIds).toEqual({ googleBooks: 'Fq9ODwAAQBAJ', openLibrary: 'OL26389863M' });
  });
  it('falls back to either side when one is missing', () => {
    expect(mergeMetadata(null, gb)).toBe(gb);
    expect(mergeMetadata(ol, null)).toBe(ol);
    expect(mergeMetadata(null, null)).toBeNull();
    expect(mergeMetadata({ ...ol, summary: null, pageCount: null }, { ...gb, summary: null, pageCount: 400 })!.pageCount).toBe(400);
  });
});

describe('genre suggestion', () => {
  const g = (id: string, code: string, sortOrder: number, ...kw: Array<string | [string, number]>): GenreWithKeywords => ({
    id, code, sortOrder, keywords: kw.map((k) => (typeof k === 'string' ? { keyword: k, weight: 1 } : { keyword: k[0], weight: k[1] })),
  });
  const genres = [g('fic', 'FIC', 1, 'fiction', 'novel'), g('sff', 'SFF', 5, 'science fiction', 'fantasy'), g('art', 'ART', 25, 'art'), g('hin', 'HIN', 21, 'hindi')];
  it('scores by keyword weight with whole-word matching', () => {
    expect(suggestGenre(['Fiction / Literary', 'Grief'], 'en', genres).suggestedGenreId).toBe('fic');
    // "heart" must not trigger the "art" keyword
    expect(suggestGenre(['Heart disease'], 'en', genres).suggestedGenreId).toBeUndefined();
    const r = suggestGenre(['Science fiction', 'Fantasy'], 'en', genres);
    expect(r.suggestedGenreId).toBe('sff'); // fantasy + science fiction = 2, fiction = 1 (science fiction contains the word fiction)
    expect(r.alternativeGenreIds).toEqual(['fic']);
  });
  it('boosts the regional genre for non-English books', () => {
    expect(suggestGenre(['Novel'], 'hi', genres).suggestedGenreId).toBe('hin');
    expect(suggestGenre(['Novel'], 'en', genres).suggestedGenreId).toBe('fic');
  });
  it('returns nothing when nothing matches', () => {
    expect(suggestGenre(['Quilting'], 'en', genres)).toEqual({ suggestedGenreId: undefined, alternativeGenreIds: [] });
  });
});

describe('text helpers', () => {
  it('trims summaries at a sentence boundary', () => {
    const long = 'First sentence here. '.repeat(100);
    const s = cleanSummary(long, 1500)!;
    expect(s.length).toBeLessThanOrEqual(1500);
    expect(s.endsWith('.')).toBe(true);
    expect(cleanSummary('<b>Hi</b> &amp; bye')).toBe('Hi & bye');
    expect(cleanSummary('')).toBeNull();
  });
  it('normalizes languages and years', () => {
    expect(normalizeLanguage('/languages/eng')).toBe('en');
    expect(normalizeLanguage('hin')).toBe('hi');
    expect(normalizeLanguage('xx1')).toBeNull();
    expect(yearFrom('June 30, 2015')).toBe(2015);
    expect(yearFrom('n.d.')).toBeNull();
  });
});

describe('ProviderGate', () => {
  it('opens the circuit after 5 consecutive failures, then refuses calls', async () => {
    const gate = new ProviderGate({ name: 'x', minIntervalMs: 0, failureThreshold: 5, openMs: 60_000 });
    for (let i = 0; i < 5; i++) await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(gate.run(async () => 1)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
  it('a success resets the failure count', async () => {
    const gate = new ProviderGate({ name: 'x', minIntervalMs: 0, failureThreshold: 3 });
    for (let i = 0; i < 2; i++) await expect(gate.run(() => Promise.reject(new Error('e')))).rejects.toThrow();
    await gate.run(async () => 1);
    for (let i = 0; i < 2; i++) await expect(gate.run(() => Promise.reject(new Error('e')))).rejects.toThrow();
    expect(await gate.run(async () => 'still closed')).toBe('still closed');
  });
  it('spaces calls by the minimum interval', async () => {
    const gate = new ProviderGate({ name: 'x', minIntervalMs: 60 });
    const t0 = Date.now();
    await Promise.all([gate.run(async () => 1), gate.run(async () => 2), gate.run(async () => 3)]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
  });
});

describe('SSRF guard', () => {
  it('flags non-public addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '224.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '151.101.1.1', '172.32.0.1', '2606:4700:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

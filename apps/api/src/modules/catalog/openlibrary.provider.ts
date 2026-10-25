import { toIsbn13, isValidIsbn10, type CatalogMetadata, type CatalogSearchHit } from '@bookstall/shared';
import { dedupe, normalizeLanguage, yearFrom, cleanSummary } from './text.js';
import { fetchJson, type ProviderGate } from './provider-gate.js';


interface OlBook {
  title?: string;
  subtitle?: string;
  authors?: Array<{ name?: string }>;
  publishers?: Array<{ name?: string }>;
  publish_date?: string;
  number_of_pages?: number;
  subjects?: Array<{ name?: string }>;
  cover?: { small?: string; medium?: string; large?: string };
  identifiers?: { isbn_10?: string[]; isbn_13?: string[]; openlibrary?: string[] };
}

export function mapOpenLibraryBook(isbn13: string, b: OlBook): CatalogMetadata | null {
  if (!b.title) return null;
  const isbn10 = b.identifiers?.isbn_10?.find((v) => isValidIsbn10(v)) ?? null;
  const olid = b.identifiers?.openlibrary?.[0];
  const cover = b.cover?.large ?? b.cover?.medium ?? b.cover?.small ?? null;
  return {
    isbn13,
    isbn10,
    title: b.title.trim(),
    subtitle: b.subtitle?.trim() || null,
    authors: dedupe((b.authors ?? []).map((a) => a.name), 20),
    publisher: b.publishers?.[0]?.name?.trim() || null,
    publishedYear: yearFrom(b.publish_date),
    language: null, // filled from /isbn/{isbn}.json
    pageCount: b.number_of_pages && b.number_of_pages > 0 ? b.number_of_pages : null,
    summary: null, // filled from the work record
    subjects: dedupe((b.subjects ?? []).map((s) => s.name)),
    coverUrl: cover ?? `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`,
    externalIds: olid ? { openLibrary: olid } : {},
  };
}

export function descriptionOf(work: { description?: string | { value?: string } } | null): string | null {
  const d = work?.description;
  const raw = typeof d === 'string' ? d : d?.value;
  return cleanSummary(raw);
}

interface SearchDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
}

export function mapOpenLibrarySearch(docs: SearchDoc[]): CatalogSearchHit[] {
  return docs
    .filter((d) => d.title)
    .map((d) => ({
      source: 'OPEN_LIBRARY' as const,
      title: d.title!,
      authors: dedupe(d.author_name ?? [], 5),
      firstPublishYear: d.first_publish_year ?? null,
      isbn13: (d.isbn ?? []).map((i) => toIsbn13(i)).find(Boolean) ?? null,
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
    }));
}

export class OpenLibraryProvider {
  constructor(
    private readonly gate: ProviderGate,
    private readonly opts: { userAgent: string; timeoutMs: number; baseUrl?: string },
  ) {}

  private get<T>(path: string) {
    return this.gate.run(() =>
      fetchJson<T>((this.opts.baseUrl ?? 'https://openlibrary.org').replace(/\/+$/, '') + path, { timeoutMs: this.opts.timeoutMs, headers: { 'User-Agent': this.opts.userAgent } }),
    );
  }

  /** Returns null when Open Library does not know the ISBN; throws when it cannot be reached. */
  async lookupIsbn(isbn13: string): Promise<CatalogMetadata | null> {
    const data = await this.get<Record<string, OlBook>>(
      `/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`,
    );
    const book = data?.[`ISBN:${isbn13}`];
    const meta = book ? mapOpenLibraryBook(isbn13, book) : null;
    if (!meta) return null;

    // Best effort: language and the work-level description. Failures here never lose the hit.
    try {
      const edition = await this.get<{ works?: Array<{ key: string }>; languages?: Array<{ key: string }> }>(
        `/isbn/${isbn13}.json`,
      );
      meta.language = normalizeLanguage(edition?.languages?.[0]?.key);
      const workKey = edition?.works?.[0]?.key;
      if (workKey && /^\/works\/OL\w+$/.test(workKey)) {
        meta.summary = descriptionOf(await this.get(`${workKey}.json`));
      }
    } catch {
      /* keep partial metadata */
    }
    return meta;
  }

  async search(q: string, author?: string): Promise<CatalogSearchHit[]> {
    const params = new URLSearchParams({
      q,
      fields: 'key,title,author_name,first_publish_year,isbn,cover_i,subject,language',
      limit: '10',
    });
    if (author) params.set('author', author);
    const data = await this.get<{ docs?: SearchDoc[] }>(`/search.json?${params}`);
    return mapOpenLibrarySearch(data?.docs ?? []);
  }
}

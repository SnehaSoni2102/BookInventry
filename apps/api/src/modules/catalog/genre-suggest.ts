export interface GenreWithKeywords {
  id: string;
  code: string;
  sortOrder: number;
  keywords: Array<{ keyword: string; weight: number }>;
}

export interface GenreSuggestion {
  suggestedGenreId?: string;
  alternativeGenreIds: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Scores each genre by the summed weight of its keywords found in the subjects/categories
 * (whole-word, case-insensitive; each keyword counts once). A non-English book gets +2 on `HIN`.
 * The user always confirms the result.
 */
export function suggestGenre(
  subjects: readonly string[],
  language: string | null | undefined,
  genres: readonly GenreWithKeywords[],
): GenreSuggestion {
  const haystack = subjects.map((s) => s.toLowerCase());
  const scored = genres.map((g) => {
    let score = 0;
    for (const { keyword, weight } of g.keywords) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(keyword)}([^\\p{L}\\p{N}]|$)`, 'iu');
      if (haystack.some((s) => re.test(s))) score += weight;
    }
    if (g.code === 'HIN' && language && language !== 'en') score += 2;
    return { g, score };
  });
  const ranked = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.g.sortOrder - b.g.sortOrder);
  return {
    suggestedGenreId: ranked[0]?.g.id,
    alternativeGenreIds: ranked.slice(1, 4).map((r) => r.g.id),
  };
}

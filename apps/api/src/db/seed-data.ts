export interface GenreSeed {
  code: string;
  name: string;
  color: string;
  keywords: string[];
}

/** Order here is the physical order along the shelves (sort_order = index + 1). */
export const GENRES: GenreSeed[] = [
  { code: 'FIC', name: 'Fiction (General & Literary)', color: '#4C6EF5', keywords: ['fiction', 'novel', 'literary'] },
  { code: 'CLS', name: 'Classics', color: '#7048E8', keywords: ['classic', 'classics'] },
  { code: 'MYS', name: 'Mystery & Thriller', color: '#343A40', keywords: ['mystery', 'detective', 'thriller', 'crime', 'suspense'] },
  { code: 'ROM', name: 'Romance', color: '#E64980', keywords: ['romance', 'love stories'] },
  { code: 'SFF', name: 'Sci-Fi & Fantasy', color: '#15AABF', keywords: ['science fiction', 'fantasy', 'dystopia', 'magic'] },
  { code: 'HOR', name: 'Horror', color: '#862E2E', keywords: ['horror', 'ghost'] },
  { code: 'YA', name: 'Young Adult', color: '#F76707', keywords: ['young adult', 'teen'] },
  { code: 'CHI', name: 'Children', color: '#FAB005', keywords: ['juvenile', 'children', 'picture books'] },
  { code: 'CMC', name: 'Comics & Graphic Novels', color: '#FF6B6B', keywords: ['comics', 'graphic novels', 'manga'] },
  { code: 'BIO', name: 'Biography & Memoir', color: '#845EF7', keywords: ['biography', 'autobiography', 'memoir'] },
  { code: 'HIS', name: 'History', color: '#A9722E', keywords: ['history', 'historical'] },
  { code: 'POL', name: 'Politics & Society', color: '#5C7CFA', keywords: ['politics', 'sociology', 'social science'] },
  { code: 'PHI', name: 'Philosophy', color: '#868E96', keywords: ['philosophy'] },
  { code: 'REL', name: 'Religion & Spirituality', color: '#F59F00', keywords: ['religion', 'spirituality', 'hinduism', 'buddhism'] },
  { code: 'SLF', name: 'Self-Help & Personal Growth', color: '#40C057', keywords: ['self-help', 'motivation', 'success', 'psychology'] },
  { code: 'BUS', name: 'Business & Economics', color: '#228BE6', keywords: ['business', 'economics', 'management', 'finance'] },
  { code: 'SCI', name: 'Science & Nature', color: '#12B886', keywords: ['science', 'physics', 'biology', 'nature'] },
  { code: 'TEC', name: 'Technology & Computing', color: '#1C7ED6', keywords: ['computers', 'programming', 'technology'] },
  { code: 'ACA', name: 'Academic & Textbooks', color: '#0B7285', keywords: ['textbooks', 'study guides', 'education'] },
  { code: 'EXM', name: 'Competitive Exams', color: '#E8590C', keywords: ['examinations', 'upsc', 'jee', 'neet', 'gate'] },
  { code: 'HIN', name: 'Hindi & Regional Literature', color: '#D6336C', keywords: ['hindi', 'marathi', 'bengali', 'tamil'] },
  { code: 'POE', name: 'Poetry & Drama', color: '#AE3EC9', keywords: ['poetry', 'drama', 'plays'] },
  { code: 'CKG', name: 'Cooking & Lifestyle', color: '#74B816', keywords: ['cooking', 'recipes', 'health', 'fitness'] },
  { code: 'TRV', name: 'Travel', color: '#0CA678', keywords: ['travel', 'guidebooks'] },
  { code: 'ART', name: 'Art & Photography', color: '#BE4BDB', keywords: ['art', 'photography', 'design'] },
  { code: 'REF', name: 'Reference & Dictionaries', color: '#495057', keywords: ['dictionaries', 'encyclopedias', 'reference'] },
  { code: 'OTH', name: 'Other', color: '#888888', keywords: [] },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'org.name': 'Goonj',
  'org.currency': 'INR',
  'org.locale': 'en-IN',
  'org.timezone': 'Asia/Kolkata',
  'copy.codePrefix': 'BK',
  'label.defaultTemplate': 'THERMAL_50x25',
  'pricing.conditionPercent': { NEW: 60, LIKE_NEW: 50, VERY_GOOD: 40, GOOD: 35, FAIR: 25, POOR: 15 },
  'pricing.roundToMinor': 1000,
  'sales.managerSeesWholeStall': false,
  'public.enabled': true,
  'public.fields': [
    'cover', 'title', 'authors', 'genre', 'condition', 'sellingPrice', 'originalPrice', 'summary', 'availability',
  ],
  'stall.deactivateManagersOnClose': true,
  'session.autoLockMinutes': 30,
  'shelf.lowSpaceThresholdPercent': 90,
};

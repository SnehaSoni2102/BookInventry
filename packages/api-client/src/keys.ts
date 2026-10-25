/** Query-key factory. The realtime handler invalidates by these prefixes (see 02-BACKEND §6.9). */
export const qk = {
  me: () => ['auth', 'me'] as const,
  dashboard: () => ['dashboard'] as const,
  settings: () => ['settings'] as const,
  genres: () => ['genres'] as const,
  users: { all: () => ['users'] as const, list: (p?: object) => ['users', 'list', p ?? {}] as const, one: (id: string) => ['users', id] as const },
  shelves: { map: () => ['shelves', 'map'] as const, rows: () => ['shelves', 'rows'] as const, racks: () => ['shelves', 'racks'] as const, slots: (id: string) => ['shelves', 'slots', id] as const, unshelved: () => ['shelves', 'unshelved'] as const },
  titles: { all: () => ['titles'] as const, list: (p?: object) => ['titles', 'list', p ?? {}] as const, one: (id: string) => ['titles', id] as const },
  copies: { all: () => ['copies'] as const, list: (p?: object) => ['copies', 'list', p ?? {}] as const, one: (id: string) => ['copies', id] as const, byCode: (c: string) => ['copies', 'code', c] as const },
  labels: { queue: (p?: object) => ['labels', 'queue', p ?? {}] as const },
  stalls: { all: () => ['stalls'] as const, list: (s?: string) => ['stalls', 'list', s ?? ''] as const, one: (id: string) => ['stalls', id] as const, mine: () => ['stalls', 'mine'] as const, inventory: (id: string, p?: object) => ['stalls', id, 'inventory', p ?? {}] as const, movements: (id: string, p?: object) => ['stalls', id, 'movements', p ?? {}] as const, recon: (id: string) => ['stalls', id, 'reconciliation'] as const },
  sales: { all: () => ['sales'] as const, list: (p?: object) => ['sales', 'list', p ?? {}] as const, one: (id: string) => ['sales', id] as const, summary: (p?: object) => ['sales', 'summary', p ?? {}] as const },
  imports: { all: () => ['imports'] as const, list: () => ['imports', 'list'] as const, one: (id: string) => ['imports', id] as const, rows: (id: string, p?: object) => ['imports', id, 'rows', p ?? {}] as const },
  audit: (p?: object) => ['audit', p ?? {}] as const,
  catalog: { lookup: (isbn: string) => ['catalog', 'lookup', isbn] as const, search: (q: string, a?: string) => ['catalog', 'search', q, a ?? ''] as const },
  publicCopy: (code: string) => ['public', code] as const,
};

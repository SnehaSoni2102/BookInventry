// Dev-only demo data, created through the running API (so every rule — slots, audit, labels — applies).
// Usage: API_URL=http://localhost:3000/api/v1 SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=... pnpm db:seed:demo
const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
const password = process.env.SEED_ADMIN_PASSWORD;
if (process.env.NODE_ENV === 'production') throw new Error('seed:demo must not run in production');
if (!password) throw new Error('Set SEED_ADMIN_PASSWORD (the admin must already have changed any temporary password)');

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const { accessToken } = await call<{ accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
const genres = await call<Array<{ id: string; code: string }>>('/genres', { token: accessToken });

const authors = ['Asha Rao', 'Vikram Sen', 'Meera Nair', 'Karan Joshi', 'Leela Iyer', 'Rohan Das', 'Nisha Kapoor', 'Imran Qureshi'];
const adjectives = ['Silent', 'Golden', 'Hidden', 'Last', 'Distant', 'Crimson', 'Quiet', 'Broken', 'Endless', 'Winter'];
const nouns = ['River', 'Garden', 'Letter', 'Mountain', 'Harbour', 'Orchard', 'Compass', 'Lantern', 'Monsoon', 'Bridge'];
const conditions = ['NEW', 'VERY_GOOD', 'GOOD', 'FAIR'];

let titles = 0;
let copies = 0;
for (let i = 0; i < 50; i++) {
  const genre = genres[i % genres.length]!;
  const quantity = 1 + (i % 5);
  const res = await call<{ copies: unknown[] }>('/copies', {
    method: 'POST',
    token: accessToken,
    body: JSON.stringify({
      clientRef: crypto.randomUUID(),
      quantity,
      copy: { condition: conditions[i % conditions.length], sellingPriceMinor: (40 + (i % 12) * 15) * 100, originalPriceMinor: (99 + (i % 12) * 30) * 100 },
      title: { title: `The ${adjectives[i % 10]} ${nouns[(i * 3) % 10]}`, authors: [authors[i % authors.length]], genreId: genre.id, publishedYear: 2000 + (i % 24), language: 'en' },
    }),
  });
  titles += 1;
  copies += res.copies.length;
}
console.log(`demo data created: ${titles} titles, ${copies} copies (create stalls and sales from the app)`);

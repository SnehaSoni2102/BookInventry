import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const API = 'http://127.0.0.1:3100/api/v1';
export const ADMIN = { username: 'admin', password: 'E2e-Admin-Pass-9' };

export async function apiLogin(request: APIRequestContext, username: string, password: string): Promise<string> {
  const res = await request.post(`${API}/auth/login`, { data: { username, password, client: 'mobile' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).accessToken as string;
}

/** First-run admin: log in with the seed password and set the real one. */
export async function bootstrapAdmin(request: APIRequestContext): Promise<string> {
  const first = await request.post(`${API}/auth/login`, { data: { username: 'admin', password: 'Admin-Pass-1', client: 'mobile' } });
  if (!first.ok()) return apiLogin(request, ADMIN.username, ADMIN.password); // already bootstrapped
  const token = (await first.json()).accessToken as string;
  const ch = await request.post(`${API}/auth/change-password`, { headers: { Authorization: `Bearer ${token}` }, data: { currentPassword: 'Admin-Pass-1', newPassword: ADMIN.password } });
  expect(ch.ok(), await ch.text()).toBeTruthy();
  return (await ch.json()).accessToken as string;
}

/** Creates an account that can sign in straight away (no forced password change). */
export async function ensureUser(request: APIRequestContext, adminToken: string, username: string, role: string, password: string) {
  const tmp = 'Temp-Pass-123x';
  const created = await request.post(`${API}/users`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { username, displayName: username, role, password: tmp } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const token = await apiLogin(request, username, tmp);
  const ch = await request.post(`${API}/auth/change-password`, { headers: { Authorization: `Bearer ${token}` }, data: { currentPassword: tmp, newPassword: password } });
  expect(ch.ok(), await ch.text()).toBeTruthy();
}

export async function loginUi(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Behaves like a USB/Bluetooth keyboard-wedge scanner: the whole code arrives as a burst of keystrokes (about 1 ms
 * apart) followed by Enter. Playwright's own keyboard.type() is too slow under load to look like a scanner, so the
 * burst is dispatched inside the page. Focus must not be in a text field (a scanner types into whatever has focus).
 */
export async function wedgeScan(page: Page, value: string) {
  await page.evaluate((code) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    for (const key of [...code, 'Enter']) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
  }, value);
}

export async function createBooks(request: APIRequestContext, token: string, opts: { title: string; genreCode?: string; price?: number; quantity?: number; condition?: string; authors?: string[] }) {
  const genres = (await (await request.get(`${API}/genres`, { headers: { Authorization: `Bearer ${token}` } })).json()) as Array<{ id: string; code: string }>;
  const res = await request.post(`${API}/copies`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      clientRef: crypto.randomUUID(), quantity: opts.quantity ?? 1,
      copy: { condition: opts.condition ?? 'GOOD', sellingPriceMinor: opts.price ?? 10000 },
      title: { title: opts.title, authors: opts.authors ?? ['E2E Author'], genreId: genres.find((g) => g.code === (opts.genreCode ?? 'FIC'))!.id },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { title: { id: string }; copies: Array<{ id: string; code: string; locationCode: string | null }> };
}

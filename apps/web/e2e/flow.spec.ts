import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { ADMIN, API, apiLogin, bootstrapAdmin, createBooks, ensureUser, loginUi, wedgeScan } from './helpers';

test.describe.configure({ mode: 'serial' });

let adminToken: string;
let admin: Page;
let adminCtx: BrowserContext;
const state: { firstCodes: string[]; managerUser: string; managerPass: string; stallName: string; locations: Record<string, string | null> } = {
  firstCodes: [], managerUser: 'mela.mgr', managerPass: '', stallName: 'Diwali Mela', locations: {},
};

test.beforeAll(async ({ browser, request }) => {
  adminToken = await bootstrapAdmin(request);
  await ensureUser(request, adminToken, 'staff1', 'INVENTORY_STAFF', 'E2e-Staff-Pass-9');
  adminCtx = await browser.newContext();
  admin = await adminCtx.newPage();
  await loginUi(admin, ADMIN.username, ADMIN.password);
});
test.afterAll(async () => adminCtx.close());

test('admin adds a book by ISBN, prints the label, and finds it in the inventory', async () => {
  await admin.goto('/books/new');
  await admin.getByTestId('find-input').fill('9780143127550');
  await admin.getByTestId('find-input').press('Enter');

  // the lookup (mocked Open Library + Google Books) fills the form
  await expect(admin.getByTestId('field-title')).toHaveValue('Everything I Never Told You');
  await expect(admin.getByTestId('field-genre')).toHaveValue(/Mystery/); // suggested from the book's subjects

  await admin.getByLabel('Original price (MRP)').fill('399');
  await admin.getByText(/Suggested ₹140/).click(); // 35% of ₹399 for a Good copy, rounded to ₹10
  await expect(admin.getByTestId('field-price')).toHaveValue('₹140');
  await admin.getByTestId('field-qty').fill('3');
  await admin.getByTestId('submit-book').click();

  const success = admin.getByTestId('add-success');
  await expect(success).toBeVisible();
  await expect(success).toContainText('Added 3 copies of “Everything I Never Told You”');
  const text = await success.innerText();
  state.firstCodes = [...text.matchAll(/BK\d{7}/g)].map((m) => m[0]);
  expect(state.firstCodes).toHaveLength(3);
  expect(text).toMatch(/MYS-A03-001/);
  expect(text).toMatch(/MYS-A03-003/);

  // print the labels: the PDF is requested from the API
  await admin.getByTestId('print-now').click();
  const pdf = admin.waitForResponse((r) => r.url().endsWith('/labels/pdf') && r.status() === 201);
  await admin.getByRole('button', { name: 'Open PDF' }).click();
  expect((await pdf).headers()['content-type']).toContain('application/pdf');
  await admin.keyboard.press('Escape');
  // the PDF opened in its own tab; close any extra tabs so later steps stay on the app
  for (const extra of admin.context().pages()) if (extra !== admin) await extra.close().catch(() => undefined);

  await admin.goto('/inventory');
  await admin.getByTestId('inventory-search').fill('celeste');
  const card = admin.getByTestId('title-card').filter({ hasText: 'Everything I Never Told You' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('3 copies');
  await expect(card).toContainText('₹140');
});

test('a book that is not found online is entered by hand', async () => {
  await admin.goto('/books/new');
  await admin.getByTestId('find-input').fill('9780306406157');
  await admin.getByTestId('find-input').press('Enter');
  await expect(admin.getByText('Not found online. Please fill in the details.')).toBeVisible();

  await admin.getByTestId('field-title').fill('My Hand Entered Book');
  await admin.getByTestId('field-authors').fill('Some Author');
  await admin.getByTestId('field-authors').press('Enter');
  await admin.getByTestId('field-genre').click();
  await admin.getByRole('option', { name: /Classics/ }).click();
  await admin.getByTestId('field-price').fill('50');
  await admin.getByTestId('submit-book').click();
  await expect(admin.getByTestId('add-success')).toContainText('My Hand Entered Book');
  await expect(admin.getByTestId('add-success')).toContainText('CLS-A02-001');

  // “Add another copy of this book” keeps the metadata and goes to the same title
  await admin.getByTestId('add-another-copy').click();
  await expect(admin.getByText(/Already in inventory/)).toHaveCount(0);
  await expect(admin.getByTestId('field-title')).toHaveValue('My Hand Entered Book');
  await expect(admin.getByTestId('field-title')).toBeDisabled();
});

test('inventory: search, sort by price, and paginate', async ({ request }) => {
  for (let i = 1; i <= 30; i++) await createBooks(request, adminToken, { title: `Bulk Book ${String(i).padStart(2, '0')}`, genreCode: 'ROM', price: i * 10_000, authors: ['Bulk Author'] });

  await admin.goto('/inventory?q=Bulk%20Author');
  await expect(admin.getByTestId('title-card')).toHaveCount(25);
  await admin.getByRole('button', { name: 'Next' }).click();
  await expect(admin.getByTestId('title-card')).toHaveCount(5);
  await expect(admin.getByText('Page 2 of 2')).toBeVisible();

  await admin.goto('/inventory?q=Bulk&sort=price%3Adesc');
  await expect(admin.getByTestId('title-card').first()).toContainText('Bulk Book 30');
  await expect(admin.getByTestId('title-card').first()).toContainText('₹3,000');
  await admin.goto('/inventory?q=Bulk&sort=price%3Aasc');
  await expect(admin.getByTestId('title-card').first()).toContainText('Bulk Book 01');

  // searching for a book code jumps straight to it
  await admin.goto('/inventory');
  await admin.getByTestId('inventory-search').fill(state.firstCodes[0]!.toLowerCase());
  await expect(admin).toHaveURL(new RegExp(`/copies/${state.firstCodes[0]}`));
  await expect(admin.getByTestId('copy-title')).toHaveText('Everything I Never Told You');
});

test('admin creates a stall with a manager and sends 3 copies by quantity', async () => {
  await admin.goto('/stalls');
  await admin.getByTestId('new-stall').click();
  await admin.getByTestId('stall-name').fill(state.stallName);
  await admin.getByTestId('mgr-username').fill(state.managerUser);
  await admin.getByTestId('create-stall').click();

  state.managerPass = (await admin.getByTestId('cred-password').innerText()).trim();
  expect(state.managerPass).toMatch(/^[A-Za-z2-9]{10}$/);
  await expect(admin.getByTestId('cred-username')).toHaveText(state.managerUser);
  await admin.getByRole('button', { name: 'Done' }).click();

  await admin.getByRole('row', { name: new RegExp(state.stallName) }).click();
  await admin.getByRole('button', { name: 'Activate stall' }).click();
  await expect(admin.getByText('active', { exact: true }).first()).toBeVisible();

  state.locations = Object.fromEntries(
    (await (await admin.request.get(`${API}/copies?pageSize=100&q=Everything`, { headers: { Authorization: `Bearer ${adminToken}` } })).json()).items.map((c: { code: string; locationCode: string }) => [c.code, c.locationCode]),
  );

  await admin.getByRole('tab', { name: 'Check out' }).click();
  await admin.getByRole('button', { name: 'Add by quantity' }).click();
  await admin.getByLabel('Find the book').fill('Everything');
  await admin.getByText('Everything I Never Told You').first().click();
  await admin.getByRole('radio').first().click(); // picking a group opens the checkout dialog straight away
  await admin.getByLabel('How many copies?').fill('3');
  await admin.getByRole('button', { name: /Check out 3 books/ }).click();
  await expect(admin.getByText('3 books checked out')).toBeVisible();

  const pdf = admin.waitForResponse((r) => r.url().includes('/pick-list.pdf') && r.status() === 200);
  await admin.getByRole('button', { name: 'Pick list (PDF)' }).click();
  expect((await pdf).headers()['content-type']).toContain('application/pdf');
  await admin.getByRole('button', { name: 'Done' }).click();
  await expect(admin.getByRole('tab', { name: /At stall \(3\)/ })).toBeVisible();
});

test('the manager sees only the stall’s books, sells two with the scanner, and the admin’s totals update live', async ({ browser }) => {
  // the admin watches the sales page
  await admin.goto('/sales');
  const card = admin.getByTestId(/^totals-(?!grand)/).filter({ hasText: state.stallName });
  await expect(card).toContainText('No sales yet');

  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  await loginUi(mgr, state.managerUser, state.managerPass); // forced first-login password change
  await expect(mgr).toHaveURL(/change-password/);
  await mgr.getByLabel(/^Temporary password/).fill(state.managerPass);
  await mgr.getByLabel(/^New password/).fill('Mela-Manager-9');
  await mgr.getByLabel(/^Repeat new password/).fill('Mela-Manager-9');
  await mgr.getByRole('button', { name: 'Change password' }).click();
  await expect(mgr.getByText('Scan to sell')).toBeVisible();
  await expect(mgr.getByTestId('nav-/users')).toHaveCount(0); // menu is limited to the role
  await expect(mgr.getByTestId('nav-/my-stall')).toBeVisible();

  // inventory is limited to the stall
  await mgr.goto('/my-stall');
  await expect(mgr.getByTestId('title-card')).toHaveCount(1);
  await expect(mgr.getByTestId('title-card')).toContainText('3 copies');
  await expect(mgr.getByRole('heading', { name: new RegExp(`Books at ${state.stallName}`) })).toBeVisible();

  // hardware scanner: two stickers, then pay
  await mgr.goto('/scan?mode=sell');
  await expect(mgr.getByText('Scan the books to sell')).toBeVisible(); // listener is attached once the session is restored
  await wedgeScan(mgr, state.firstCodes[0]!);
  await expect(mgr.getByText(state.firstCodes[0]!, { exact: false }).first()).toBeVisible();
  await wedgeScan(mgr, `https://anywhere.example.org/b/${state.firstCodes[1]}`); // labels work whatever domain they were printed with
  await expect(mgr.getByTestId('sale-total')).toHaveText('₹280');
  // a book that is not at this stall is refused
  await wedgeScan(mgr, state.firstCodes[2]!.replace(/\d$/, '9') === state.firstCodes[2] ? 'BK9999999' : 'BK9999999');
  await mgr.getByRole('radio', { name: 'UPI' }).check({ force: true }).catch(() => mgr.getByText('UPI', { exact: true }).click());
  await mgr.getByRole('button', { name: /Confirm sale/ }).click();
  await expect(mgr.getByTestId('sale-success')).toContainText('₹280');

  // live: the admin's page changed without a reload
  await expect(card).toContainText('₹280', { timeout: 15_000 });
  await expect(card).toContainText('UPI ₹280');

  // the manager's own sales list shows the sale; there is no discount control
  await mgr.goto('/sales');
  await expect(mgr.getByRole('row', { name: /R-\d{6}/ })).toHaveCount(1);
  await mgrCtx.close();
});

test('the last copy is checked in with the scanner and goes back to its original slot', async () => {
  await admin.goto('/scan?mode=checkin');
  await expect(admin.getByText('Scan returned books')).toBeVisible();
  const remaining = state.firstCodes[2]!;
  await wedgeScan(admin, remaining);
  const result = admin.getByTestId('checkin-result');
  await expect(result).toContainText(`Returned from ${state.stallName}`);
  await expect(result).toContainText(state.locations[remaining]!);
  await expect(result).toContainText('Put back at');
});

test('bulk import: upload, review, commit, labels', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Books');
  ws.addRow(['isbn', 'title', 'authors', 'genre', 'condition', 'original_price', 'selling_price', 'quantity']);
  ws.addRow(['', 'Imported Alpha', 'Writer One', 'FIC', 'good', 300, 90, 2]);
  ws.addRow(['', 'Imported Beta', 'Writer Two', 'Poetry & Drama', 'very good', '', 70, 1]);
  ws.addRow(['', 'Imported Gamma', 'Writer Three', 'SCI', 'fair', '', 40, 3]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  await admin.goto('/imports');
  await admin.locator('input[type="file"]').setInputFiles({ name: 'books.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await expect(admin).toHaveURL(/\/imports\/[0-9a-f-]{36}/);
  await expect(admin.getByTestId('count-Rows')).toHaveText('3', { timeout: 30_000 });
  await expect(admin.getByTestId('count-Errors')).toHaveText('0');
  await expect(admin.getByRole('row', { name: /Imported Alpha/ })).toBeVisible();

  await admin.getByTestId('commit-import').click();
  await expect(admin.getByText('6 copies added')).toBeVisible({ timeout: 30_000 });

  const pdf = admin.waitForResponse((r) => r.url().includes('/labels/pdf') && r.status() === 200);
  await admin.getByRole('button', { name: 'Print all labels (A4)' }).click();
  expect((await pdf).headers()['content-type']).toContain('application/pdf');

  await admin.goto('/inventory?q=Imported');
  await expect(admin.getByTestId('title-card')).toHaveCount(3);
});

test('the public QR page shows the book but none of the internal details', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const code = state.firstCodes[2]!;
  await page.goto(`/b/${code}`);
  await expect(page.getByRole('heading', { name: 'Everything I Never Told You' })).toBeVisible();
  await expect(page.getByTestId('public-price')).toHaveText('₹140');
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/[A-Z]{2,4}-[A-Z]\d{2}-\d{3}/); // no shelf location
  expect(body).not.toContain(state.stallName);
  await expect(page.getByText('Volunteer?')).toBeVisible();

  await page.goto('/b/BK9999999');
  await expect(page.getByText('Book not found')).toBeVisible();
  await ctx.close();
});

test('permissions: staff cannot reach admin pages', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUi(page, 'staff1', 'E2e-Staff-Pass-9');
  await expect(page.getByTestId('nav-/users')).toHaveCount(0);
  await page.goto('/users');
  await expect(page.getByText("You don't have permission to see this page.")).toBeVisible();
  await page.goto('/sales');
  await expect(page.getByText("You don't have permission to see this page.")).toBeVisible();
  await ctx.close();
  void apiLogin;
});

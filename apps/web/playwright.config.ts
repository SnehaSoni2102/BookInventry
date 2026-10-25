import { defineConfig, devices } from '@playwright/test';

const WEB = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: WEB, trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'block', viewport: { width: 1280, height: 800 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'node e2e/mock-providers.mjs', url: 'http://127.0.0.1:4010/ol/api/books', reuseExistingServer: false, timeout: 20_000 },
    { command: 'pnpm --filter @bookstall/api e2e:server', url: 'http://127.0.0.1:3100/api/v1/health/ready', reuseExistingServer: false, timeout: 45_000, cwd: '../..' },
    { command: 'pnpm exec vite preview --port 4173 --strictPort --host 127.0.0.1', url: WEB, reuseExistingServer: false, timeout: 30_000, env: { VITE_DEV_API: 'http://127.0.0.1:3100' } },
  ],
});

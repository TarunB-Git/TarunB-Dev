import { defineConfig } from '@playwright/test';
import { join } from 'node:path';

const port = Number(process.env.PORTFOLIO_E2E_PORT || 8765);
const suppliedBaseURL = process.env.PLAYWRIGHT_BASE_URL || '';
const baseURL = suppliedBaseURL || `http://127.0.0.1:${port}`;
const dataDir = join('/tmp', `fourpath-playwright-${process.pid}`);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-webgl', '--ignore-gpu-blocklist'] },
  },
  webServer: suppliedBaseURL ? undefined : {
    command: `python -m uvicorn server.main:app --host 127.0.0.1 --port ${port}`,
    url: `${baseURL}/healthz`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORTFOLIO_DATA_DIR: dataDir,
      PORTFOLIO_BASE_URL: baseURL,
      PORTFOLIO_ALLOWED_ORIGINS: baseURL,
      PORTFOLIO_SECURE_COOKIES: 'false',
      PORTFOLIO_TRUST_PROXY_HEADERS: 'true',
      ADMIN_PASSPHRASE: 'local-e2e-passphrase-only',
      ADMIN_RECOVERY_TOKEN: 'local-e2e-recovery-token-only',
    },
  },
});

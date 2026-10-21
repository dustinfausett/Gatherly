import { defineConfig, devices } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.GATHERLY_E2E_DATA_DIR ||= mkdtempSync(join(tmpdir(), 'gatherly-browser-'));
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 60000,
  reporter: 'list', globalTeardown: './e2e/cleanup.js',
  use: { baseURL: 'http://127.0.0.1:3100', launchOptions: { executablePath, args: ['--no-sandbox'] }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }, { name: 'android', use: { ...devices['Pixel 7'] } }],
  webServer: { command: 'node server/dev.js', port: 3100, reuseExistingServer: false, timeout: 30000, env: { GOOGLE_CLIENT_ID: '', PORT: '3100', DATA_DIR: process.env.GATHERLY_E2E_DATA_DIR } },
});

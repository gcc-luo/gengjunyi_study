import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://127.0.0.1:5174' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5174 --mode e2e', url: 'http://127.0.0.1:5174', reuseExistingServer: false, timeout: 120_000 },
});

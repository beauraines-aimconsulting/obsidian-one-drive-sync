import { defineConfig } from '@playwright/test';
import { DEFAULT_SERVER_ORIGIN } from './tests/e2e/support/fixtures.ts';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 30_000,
  globalSetup: './tests/e2e/globalSetup.ts',
  globalTeardown: './tests/e2e/globalTeardown.ts',
  use: {
    baseURL: DEFAULT_SERVER_ORIGIN,
    headless: true,
    trace: 'on-first-retry',
    browserName: 'chromium',
  },
  webServer: {
    command: 'TS_NODE_TRANSPILE_ONLY=1 npx ts-node --esm tests/e2e/support/runServer.ts',
    url: `${DEFAULT_SERVER_ORIGIN}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
    },
  ],
});

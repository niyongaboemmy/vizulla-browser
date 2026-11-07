import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './vizulla/test/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  workers: 1,
  // CI runners are slower and noisier than dev machines: one retry, reported as flaky.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});

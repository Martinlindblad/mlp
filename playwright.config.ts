import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'yarn build:production && cp -R public .next/standalone/public && mkdir -p .next/standalone/.next && cp -R .next/static .next/standalone/.next/static && HOSTNAME=127.0.0.1 PORT=3000 node .next/standalone/server.js',
    reuseExistingServer: !isCI,
    timeout: 180_000,
    url: 'http://127.0.0.1:3000/api/health/ready',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

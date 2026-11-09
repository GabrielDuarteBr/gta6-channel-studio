import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de ponta a ponta do painel. Rodam contra uma pilha já no ar:
 *   make e2e            (pilha isolada de teste, dentro do container do Playwright)
 *   E2E_BASE_URL=http://localhost:3000 pnpm --filter @studio/e2e e2e
 */
const executablePath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'off',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'painel',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/dono.json' },
      dependencies: ['setup'],
      testIgnore: [/auth\.setup\.ts/, /mobile\.spec\.ts/],
    },
    {
      name: 'celular',
      use: { ...devices['Pixel 7'], storageState: 'playwright/.auth/dono.json' },
      dependencies: ['setup'],
      testMatch: /mobile\.spec\.ts/,
    },
  ],
});

import { defineConfig, devices } from '@playwright/test';

/**
 * e2e de UI (P32). Contra una **build de producción** (`next start`), no `next dev`: el servidor de
 * desarrollo compila cada ruta bajo demanda la primera vez, lo que con varios workers en paralelo
 * provoca timeouts intermitentes en arranque frío. `next start` sirve todo precompilado → estable y
 * rápido. El backend va mockeado a nivel de red (ver `e2e/apoyo.ts`), así que no hace falta Postgres.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

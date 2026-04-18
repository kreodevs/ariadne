import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: arranca Vite con bypass de auth (solo entornos de prueba).
 * @see ProtectedRoute — `VITE_E2E_AUTH_BYPASS=true`
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    /** Puerto distinto al `vite dev` por defecto para no reutilizar otro SPA en 5173. */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5174',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'VITE_E2E_AUTH_BYPASS=true npm run dev -- --host 127.0.0.1 --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

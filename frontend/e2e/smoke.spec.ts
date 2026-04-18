import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/projects**', (route) => {
    if (route.request().method() !== 'GET') {
      void route.continue();
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
  await page.route('**/api/repositories**', (route) => {
    if (route.request().method() !== 'GET') {
      void route.continue();
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
  await page.route('**/api/domains**', (route) => {
    if (route.request().method() !== 'GET') {
      void route.continue();
      return;
    }
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
});

test.describe('smoke (auth bypass + API mock)', () => {
  test('redirige / a /dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('muestra Proyectos en /projects', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Proyectos' })).toBeVisible();
  });

  test('muestra The Forge en /repos', async ({ page }) => {
    await page.goto('/repos');
    await expect(page.getByRole('heading', { name: 'The Forge' })).toBeVisible();
  });
});

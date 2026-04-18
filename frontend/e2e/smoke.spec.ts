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
});

test.describe('smoke (auth bypass + API mock)', () => {
  test('muestra Proyectos en /', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Proyectos' })).toBeVisible();
  });

  test('muestra Repositorios en /repos', async ({ page }) => {
    await page.goto('/repos');
    await expect(page.getByRole('heading', { name: 'Repositorios' })).toBeVisible();
  });
});

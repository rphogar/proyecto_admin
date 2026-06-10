import { expect, test } from '@playwright/test';

test('la home muestra el nombre del producto', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ContaVE' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comenzar' })).toBeVisible();
});

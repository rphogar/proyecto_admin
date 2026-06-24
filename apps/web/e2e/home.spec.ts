import { expect, test } from '@playwright/test';
import { mockApi, tasaDelDia } from './apoyo';

test('la home muestra el producto y los accesos a módulos', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ContaVE' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mi negocio hoy' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ventas' })).toBeVisible();
});

test('caso 57: con tasa rezagada, la home muestra el banner de advertencia', async ({ page }) => {
  await mockApi(page, ({ pathname }) =>
    pathname.startsWith('/tasas/dia') ? { json: tasaDelDia('rezagada') } : undefined,
  );
  await page.goto('/');
  await expect(page.getByText(/varios días de rezago/i).first()).toBeVisible();
});

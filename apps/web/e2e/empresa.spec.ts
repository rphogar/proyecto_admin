import { expect, test } from '@playwright/test';
import { mockApi, sembrarSesion, sesionDemo, TENANT_B } from './apoyo';

/**
 * Multi-empresa (docs/06: "selector de empresa"). Cambiar de empresa re-emite un token acotado
 * validando la membresía en la API (P28); la UI debe reflejar la empresa activa nueva.
 */
test('cambio de empresa re-emite la sesión y actualiza la empresa activa', async ({ page }) => {
  await sembrarSesion(page, sesionDemo()); // arranca en TENANT_A, con dos membresías
  await mockApi(page);
  await page.goto('/dashboard');

  const selector = page.getByLabel('Empresa', { exact: true });
  await expect(selector).toBeVisible();

  await selector.selectOption(TENANT_B);

  // El cambio re-emitió el token y la sesión persistida quedó acotada a TENANT_B.
  await expect(selector).toHaveValue(TENANT_B);
  await expect
    .poll(async () => {
      const raw = await page.evaluate(() => window.localStorage.getItem('contave.sesion'));
      return raw ? (JSON.parse(raw) as { tenantActivo: string }).tenantActivo : null;
    })
    .toBe(TENANT_B);
});

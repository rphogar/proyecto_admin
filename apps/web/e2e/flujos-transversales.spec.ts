import { expect, test } from '@playwright/test';
import { mockApi, sembrarSesion } from './apoyo';

/**
 * Humo de navegación de los 5 flujos "que deben ser perfectos" (docs/06) desde el navegador, con la
 * auth real ya puesta. La verificación numérica extremo a extremo de cada flujo (factura+cobro mixto,
 * compra+retención, cierre del mes, dashboard, apertura del onboarding) vive sobre Postgres real en
 * `apps/api/src/seguridad/flujos-transversales.int.spec.ts`; aquí se comprueba que sus puntos de
 * entrada en la UI cargan y enlazan con la sesión real (token Bearer).
 */
test.describe('Flujos transversales — humo de UI', () => {
  test.beforeEach(async ({ page }) => {
    await sembrarSesion(page);
    await mockApi(page);
  });

  test('flujo 4 (dashboard del dueño) con accesos rápidos a los demás flujos', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Mi negocio hoy' })).toBeVisible();
    const accesos = page.getByRole('navigation', { name: 'Accesos rápidos' });
    await expect(accesos.getByRole('link', { name: '+ Factura' })).toBeVisible();
    await expect(accesos.getByRole('link', { name: '+ Cobro' })).toBeVisible();
    await expect(accesos.getByRole('link', { name: '+ Gasto' })).toBeVisible();
  });

  test('flujo 1 (vender y cobrar): la pantalla de cobros carga', async ({ page }) => {
    await page.goto('/ventas/cobros');
    await expect(page.getByRole('heading', { name: 'Cobros' })).toBeVisible();
  });

  test('flujo 2 (compra con retención): el registro de compra carga', async ({ page }) => {
    await page.goto('/compras/nueva');
    await expect(page).toHaveURL(/\/compras\/nueva/);
  });

  test('flujo 5 (onboarding): el asistente arranca en el paso 1', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page.getByRole('heading', { name: 'Alta de empresa' })).toBeVisible();
    await expect(page.getByText(/Paso 1 de 5/i)).toBeVisible();
  });
});

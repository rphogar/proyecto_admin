import { expect, test } from '@playwright/test';
import { mockApi, sembrarSesion, sesionDemo, TENANT_B } from './apoyo';

/** Endurecimiento del manejo de errores de la UI (P32) + superficies de los casos 54 y 55. */

test('sesión expirada (401) cierra sesión y manda al login con aviso', async ({ page }) => {
  await sembrarSesion(page);
  // El dashboard (lectura de negocio) responde 401 → token vencido/revocado.
  await mockApi(page, ({ pathname }) =>
    pathname.startsWith('/dashboard') ? { status: 401, json: { message: 'token vencido' } } : undefined,
  );

  await page.goto('/dashboard');

  await expect(page).toHaveURL(/\/login\?expirada=1/);
  await expect(page.getByText(/tu sesión expiró por seguridad/i)).toBeVisible();
  // La sesión local quedó limpia (re-login obligatorio).
  const raw = await page.evaluate(() => window.localStorage.getItem('contave.sesion'));
  expect(raw).toBeNull();
});

test('caso 54: una acción sin permiso muestra un mensaje 403 claro', async ({ page }) => {
  await sembrarSesion(page);
  await mockApi(page, ({ pathname, method }) =>
    pathname === '/tasas/manual' && method === 'POST'
      ? {
          status: 403,
          json: {
            codigo: 'RBAC_PERMISO_DENEGADO',
            message: 'El rol cajero no tiene el permiso tasas.cargar',
          },
        }
      : undefined,
  );

  await page.goto('/');
  await page.getByRole('button', { name: 'Cargar tasa manual' }).first().click();
  await page.getByPlaceholder('40.50000000').fill('41');
  await page.getByPlaceholder(/BCV no publicó/).fill('Carga de prueba');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByRole('alert').filter({ hasText: /no tiene el permiso/i })).toBeVisible();
});

test('caso 55: con otro tenant, el listado muestra 0 filas (RLS)', async ({ page }) => {
  // Sesión acotada a TENANT_B; el listado de terceros devuelve [] (RLS no filtra datos ajenos).
  await sembrarSesion(page, sesionDemo({ tenantActivo: TENANT_B }));
  await mockApi(page); // default: cualquier maestro responde []

  await page.goto('/maestros/parties');

  await expect(page.getByText(/sin terceros todavía/i)).toBeVisible();
});

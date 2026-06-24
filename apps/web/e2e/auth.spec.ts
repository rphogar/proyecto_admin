import { expect, test } from '@playwright/test';
import { mockApi, sesionEmitida } from './apoyo';

/** Login real (P27/P28) desde el navegador: credenciales, 2FA y errores claros. */
test.describe('Autenticación (login + 2FA)', () => {
  test('login con credenciales entra al dashboard del dueño', async ({ page }) => {
    await mockApi(page);
    await page.goto('/login');

    await page.getByLabel('Correo').fill('demo@contave.test');
    await page.getByLabel('Contraseña').fill('demo-contave-12345');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Mi negocio hoy' })).toBeVisible();
  });

  test('login con 2FA pide el segundo paso antes de entrar', async ({ page }) => {
    await mockApi(page, ({ pathname }) => {
      if (pathname === '/auth/login') {
        return { json: { requiere2fa: true, reto: 'reto-123' } };
      }
      if (pathname === '/auth/login/2fa') {
        return { json: sesionEmitida() };
      }
      return undefined;
    });
    await page.goto('/login');

    await page.getByLabel('Correo').fill('owner@contave.test');
    await page.getByLabel('Contraseña').fill('clave-correcta');
    await page.getByRole('button', { name: 'Entrar' }).click();

    // Aparece el segundo paso (no se entró todavía).
    const codigo = page.getByLabel('Código 2FA');
    await expect(codigo).toBeVisible();
    await codigo.fill('123456');
    await page.getByRole('button', { name: 'Verificar' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('credenciales inválidas muestran el error y no entran', async ({ page }) => {
    await mockApi(page, ({ pathname }) =>
      pathname === '/auth/login'
        ? { status: 401, json: { message: 'Correo o contraseña inválidos' } }
        : undefined,
    );
    await page.goto('/login');

    await page.getByLabel('Correo').fill('demo@contave.test');
    await page.getByLabel('Contraseña').fill('mala');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page.getByText(/correo o contraseña inválidos/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

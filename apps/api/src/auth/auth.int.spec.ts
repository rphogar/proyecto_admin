import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import type { DatabaseService } from '../db/database.service';
import { SeguridadService } from '../seguridad/seguridad.service';
import { decodificarBase32, totp } from '../seguridad/totp';
import { verificarJwt } from '../seguridad/jwt';
import { AuthService, type ParSesion } from './auth.service';

/**
 * Integración de autenticación (P27) contra Postgres real (testcontainers): login ok/fallo con
 * respuesta uniforme, rotación de refresh con detección de robo (familia revocada), 2FA como
 * segundo paso, recuperación de un solo uso y lockout tras N intentos. Requiere Docker → CI.
 */
describe('Auth — integración DB (P27)', () => {
  let tdb: TestDatabase;
  let auth: AuthService;
  let seguridad: SeguridadService;

  const PASSWORD = 'Clave-Demo-12345';
  const userBasico = randomUUID();
  const user2fa = randomUUID();
  const userReset = randomUUID();
  const userLock = randomUUID();
  const origen = { ip: '10.0.0.1', device: 'vitest' };
  const claveSinTotp = Buffer.alloc(32, 7).toString('base64');

  beforeAll(async () => {
    process.env.APP_ENCRYPTION_KEY ??= claveSinTotp;
    process.env.AUTH_JWT_SECRET ??= 'x'.repeat(48);
    process.env.AUTH_ACCESS_TTL ??= '900';
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    seguridad = new SeguridadService(database);
    auth = new AuthService(database, seguridad);

    // Hash real Argon2id de la contraseña conocida (mismo que produce el servicio).
    const { hashPassword } = await import('../seguridad/password');
    const hash = await hashPassword(PASSWORD);
    await tdb.ownerSql`insert into users (id, email, nombre, password_hash, status) values
      (${userBasico}, 'basico@a.com', 'Básico', ${hash}, 'active'),
      (${user2fa}, 'dosfa@a.com', 'DosFA', ${hash}, 'active'),
      (${userReset}, 'reset@a.com', 'Reset', ${hash}, 'active'),
      (${userLock}, 'lock@a.com', 'Lock', ${hash}, 'active')`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  function esperaSesion(r: { requiere2fa: boolean }): asserts r is { requiere2fa: false } & ParSesion {
    expect(r.requiere2fa).toBe(false);
  }

  describe('login', () => {
    it('emite access + refresh con credenciales correctas', async () => {
      const r = await auth.login('basico@a.com', PASSWORD, origen);
      esperaSesion(r);
      expect(r.accessToken).toBeTruthy();
      expect(r.refreshToken).toBeTruthy();
      const claims = verificarJwt(r.accessToken, Buffer.from(process.env.AUTH_JWT_SECRET!, 'utf8'));
      expect(claims?.sub).toBe(userBasico);
      expect(claims?.scope).toBe('access');
    });

    it('rechaza password incorrecta y email inexistente con el mismo error opaco', async () => {
      await expect(auth.login('basico@a.com', 'mala', origen)).rejects.toMatchObject({
        response: { codigo: 'CREDENCIALES_INVALIDAS' },
      });
      await expect(auth.login('noexiste@a.com', PASSWORD, origen)).rejects.toMatchObject({
        response: { codigo: 'CREDENCIALES_INVALIDAS' },
      });
    });
  });

  describe('rotación de refresh y detección de robo', () => {
    it('rota el refresh y, al reusar el viejo, revoca toda la familia', async () => {
      const r = await auth.login('basico@a.com', PASSWORD, origen);
      esperaSesion(r);
      const viejo = r.refreshToken;

      const rotado = await auth.refrescar(viejo, origen);
      expect(rotado.refreshToken).not.toBe(viejo);
      // El nuevo refresh funciona...
      const rotado2 = await auth.refrescar(rotado.refreshToken, origen);
      expect(rotado2.refreshToken).toBeTruthy();

      // ...pero reusar el PRIMERO (ya rotado) se detecta como robo y revoca la familia.
      await expect(auth.refrescar(viejo, origen)).rejects.toMatchObject({
        response: { codigo: 'REFRESH_REUSO' },
      });
      // Tras la alerta de robo, hasta el último refresh válido queda revocado.
      await expect(auth.refrescar(rotado2.refreshToken, origen)).rejects.toMatchObject({
        response: { codigo: 'REFRESH_REUSO' },
      });
    });

    it('un refresh desconocido es inválido', async () => {
      await expect(auth.refrescar('token-inexistente', origen)).rejects.toMatchObject({
        response: { codigo: 'REFRESH_INVALIDO' },
      });
    });
  });

  describe('2FA como segundo paso', () => {
    it('exige el reto y lo canjea con un código TOTP válido', async () => {
      const ahora = new Date('2026-06-22T12:00:00.000Z');
      const { base32 } = await seguridad.iniciarEnrolamiento(user2fa);
      const codigo = totp(decodificarBase32(base32), ahora.getTime());
      await seguridad.confirmarEnrolamiento(user2fa, codigo, ahora);

      const r = await auth.login('dosfa@a.com', PASSWORD, origen, ahora);
      expect(r.requiere2fa).toBe(true);
      if (!r.requiere2fa) throw new Error('debía requerir 2FA');

      // Código inválido → sin sesión.
      await expect(auth.login2fa(r.reto, '000000', origen, ahora)).rejects.toMatchObject({
        response: { codigo: 'CODIGO_2FA_INVALIDO' },
      });
      // Código correcto → sesión emitida.
      const sesion = await auth.login2fa(r.reto, codigo, origen, ahora);
      expect(sesion.accessToken).toBeTruthy();
      expect(sesion.refreshToken).toBeTruthy();
    });
  });

  describe('recuperación de contraseña', () => {
    it('token de un solo uso: cambia la clave, revoca sesiones y no se puede reusar', async () => {
      // Sesión previa que debe quedar invalidada al resetear.
      const sesionPrevia = await auth.login('reset@a.com', PASSWORD, origen);
      esperaSesion(sesionPrevia);

      const { tokenDev } = await auth.solicitarRecuperacion('reset@a.com', origen);
      expect(tokenDev).toBeTruthy();

      const nueva = 'Nueva-Clave-67890';
      await auth.confirmarRecuperacion(tokenDev!, nueva, origen);

      // La clave vieja ya no sirve; la nueva sí.
      await expect(auth.login('reset@a.com', PASSWORD, origen)).rejects.toMatchObject({
        response: { codigo: 'CREDENCIALES_INVALIDAS' },
      });
      const r = await auth.login('reset@a.com', nueva, origen);
      esperaSesion(r);

      // La sesión previa quedó revocada y el token de reset no se puede reusar.
      await expect(auth.refrescar(sesionPrevia.refreshToken, origen)).rejects.toMatchObject({
        response: { codigo: 'REFRESH_REUSO' },
      });
      await expect(auth.confirmarRecuperacion(tokenDev!, 'Otra-Mas-12345', origen)).rejects.toMatchObject({
        response: { codigo: 'RESET_INVALIDO' },
      });
    });

    it('no revela si el email existe (responde igual)', async () => {
      const r = await auth.solicitarRecuperacion('fantasma@a.com', origen);
      expect(r.tokenDev).toBeUndefined();
    });
  });

  describe('lockout', () => {
    it('bloquea la cuenta tras 5 intentos fallidos', async () => {
      const cred = { email: 'lock@a.com', ip: '10.9.9.9', device: 'vitest' };
      for (let i = 0; i < 5; i += 1) {
        await expect(auth.login(cred.email, 'mala', cred)).rejects.toMatchObject({
          response: { codigo: 'CREDENCIALES_INVALIDAS' },
        });
      }
      // El 6º intento (incluso con la clave correcta) está bloqueado.
      await expect(auth.login(cred.email, PASSWORD, cred)).rejects.toMatchObject({
        response: { codigo: 'CUENTA_BLOQUEADA' },
      });
    });
  });
});

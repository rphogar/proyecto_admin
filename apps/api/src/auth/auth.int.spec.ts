import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import type { DatabaseService } from '../db/database.service';
import { PermisosService } from '../seguridad/permisos.service';
import { SeguridadService } from '../seguridad/seguridad.service';
import { decodificarBase32, totp } from '../seguridad/totp';
import { verificarJwt } from '../seguridad/jwt';
import { AuthService, type SesionEmitida } from './auth.service';

/**
 * Integración de autenticación (P27/P28) contra Postgres real (testcontainers): login ok/fallo con
 * respuesta uniforme, rotación de refresh con detección de robo (familia revocada), 2FA como
 * segundo paso, recuperación de un solo uso y lockout tras N intentos. P28: la sesión emitida va
 * acotada a un tenant (`tid`). Requiere Docker → CI.
 */
describe('Auth — integración DB (P27/P28)', () => {
  let tdb: TestDatabase;
  let auth: AuthService;
  let seguridad: SeguridadService;

  const PASSWORD = 'Clave-Demo-12345';
  const tenant = randomUUID();
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
    auth = new AuthService(database, seguridad, new PermisosService(database));

    // Hash real Argon2id de la contraseña conocida (mismo que produce el servicio).
    const { hashPassword } = await import('../seguridad/password');
    const hash = await hashPassword(PASSWORD);
    await tdb.ownerSql`insert into users (id, email, nombre, password_hash, status) values
      (${userBasico}, 'basico@a.com', 'Básico', ${hash}, 'active'),
      (${user2fa}, 'dosfa@a.com', 'DosFA', ${hash}, 'active'),
      (${userReset}, 'reset@a.com', 'Reset', ${hash}, 'active'),
      (${userLock}, 'lock@a.com', 'Lock', ${hash}, 'active')`;

    // P28: cada usuario necesita membresía para que el login emita una sesión acotada al tenant.
    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenant}, 'Tenant Auth', 'tenant-auth')`;
    await tdb.ownerSql`insert into memberships (tenant_id, user_id, role) values
      (${tenant}, ${userBasico}, 'owner'),
      (${tenant}, ${user2fa}, 'owner'),
      (${tenant}, ${userReset}, 'owner'),
      (${tenant}, ${userLock}, 'owner')`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  function esperaSesion(
    r: { requiere2fa: boolean },
  ): asserts r is { requiere2fa: false } & SesionEmitida {
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
      // P28: el access va acotado al tenant del usuario y la respuesta trae el selector de empresas.
      expect(claims?.tid).toBe(tenant);
      expect(r.tenantActivo).toBe(tenant);
      expect(r.empresas).toEqual([{ tenantId: tenant, nombre: 'Tenant Auth', rol: 'owner' }]);
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

  describe('P28 — multi-empresa y cambio seguro', () => {
    it('el refresh hereda el tenant de la sesión (tid estable al rotar)', async () => {
      const r = await auth.login('basico@a.com', PASSWORD, origen);
      esperaSesion(r);
      const rotado = await auth.refrescar(r.refreshToken, origen);
      const claves = Buffer.from(process.env.AUTH_JWT_SECRET!, 'utf8');
      expect(verificarJwt(rotado.accessToken, claves)?.tid).toBe(tenant);
    });

    it('cambia a una segunda empresa donde el usuario es miembro', async () => {
      const tenantB = randomUUID();
      await tdb.ownerSql`insert into tenants (id, nombre, slug) values
        (${tenantB}, 'Tenant Auth B', 'tenant-auth-b')`;
      await tdb.ownerSql`insert into memberships (tenant_id, user_id, role) values
        (${tenantB}, ${userBasico}, 'contador')`;

      const sesion = await auth.cambiarEmpresa(userBasico, tenantB, origen);
      expect(sesion.tenantActivo).toBe(tenantB);
      expect(verificarJwt(sesion.accessToken, Buffer.from(process.env.AUTH_JWT_SECRET!, 'utf8'))?.tid)
        .toBe(tenantB);
      // El selector ahora lista ambas empresas.
      expect(sesion.empresas.map((e) => e.tenantId).sort()).toEqual([tenant, tenantB].sort());
    });

    it('NO se puede forzar un tenant sin membresía (403 + auditoría)', async () => {
      const ajeno = randomUUID();
      await tdb.ownerSql`insert into tenants (id, nombre, slug) values
        (${ajeno}, 'Ajeno', 'ajeno')`;
      await expect(auth.cambiarEmpresa(userBasico, ajeno, origen)).rejects.toMatchObject({
        response: { codigo: 'SIN_MEMBRESIA' },
      });
      const [evento] = await tdb.ownerSql<{ tipo: string }[]>`
        select tipo from auth_events
        where user_id = ${userBasico} and tipo = 'cambio_empresa_denegado' limit 1`;
      expect(evento?.tipo).toBe('cambio_empresa_denegado');
    });

    it('un usuario sin ninguna membresía no obtiene sesión (SIN_EMPRESAS)', async () => {
      const huerfano = randomUUID();
      const { hashPassword } = await import('../seguridad/password');
      await tdb.ownerSql`insert into users (id, email, nombre, password_hash, status) values
        (${huerfano}, 'huerfano@a.com', 'Huérfano', ${await hashPassword(PASSWORD)}, 'active')`;
      await expect(auth.login('huerfano@a.com', PASSWORD, origen)).rejects.toMatchObject({
        response: { codigo: 'SIN_EMPRESAS' },
      });
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

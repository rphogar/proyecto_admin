import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseService } from '../db/database.service';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { decodificarBase32, totp } from './totp';
import { PermisosService } from './permisos.service';
import { SeguridadService } from './seguridad.service';

/**
 * Integración de seguridad (P18) contra Postgres real (testcontainers): la política RBAC sembrada
 * en migraciones enforce realmente (caso 54: cajero no cierra período ni ve salarios; contador
 * sí), el rol cross-tenant no se resuelve (aislamiento), y el enrolamiento 2FA persiste el secreto
 * **cifrado** y se activa con un código TOTP válido. Requiere Docker → CI.
 */
describe('Seguridad — integración DB (P18)', () => {
  let tdb: TestDatabase;
  let permisos: PermisosService;
  let seguridad: SeguridadService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userCajero = randomUUID();
  const userContador = randomUUID();
  const userOwner = randomUUID();

  beforeAll(async () => {
    process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    permisos = new PermisosService(database);
    seguridad = new SeguridadService(database);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a'), (${tenantB}, 'Tenant B', 'tenant-b')`;
    await tdb.ownerSql`insert into users (id, email, nombre) values
      (${userCajero}, 'cajero@a.com', 'Caja'),
      (${userContador}, 'contador@a.com', 'Conta'),
      (${userOwner}, 'owner@a.com', 'Dueño')`;
    await tdb.ownerSql`insert into memberships (tenant_id, user_id, role) values
      (${tenantA}, ${userCajero}, 'cajero'),
      (${tenantA}, ${userContador}, 'contador'),
      (${tenantA}, ${userOwner}, 'owner')`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  describe('RBAC por acción (caso 54)', () => {
    it('el cajero puede emitir pero NO cerrar período ni ver salarios', async () => {
      expect(await permisos.puede(tenantA, userCajero, 'document.issue')).toBe(true);
      expect(await permisos.puede(tenantA, userCajero, 'period.close')).toBe(false);
      expect(await permisos.puede(tenantA, userCajero, 'salary.read')).toBe(false);
    });

    it('el contador cierra período y ve salarios, pero no emite', async () => {
      expect(await permisos.puede(tenantA, userContador, 'period.close')).toBe(true);
      expect(await permisos.puede(tenantA, userContador, 'salary.read')).toBe(true);
      expect(await permisos.puede(tenantA, userContador, 'document.issue')).toBe(false);
    });

    it('el owner tiene todos los permisos sembrados', async () => {
      expect(await permisos.puede(tenantA, userOwner, 'document.issue')).toBe(true);
      expect(await permisos.puede(tenantA, userOwner, 'period.close')).toBe(true);
      expect(await permisos.puede(tenantA, userOwner, 'company.manage')).toBe(true);
    });

    it('un usuario sin membresía en el tenant no resuelve rol (aislamiento)', async () => {
      expect(await permisos.rolDelActor(tenantB, userCajero)).toBeNull();
      expect(await permisos.puede(tenantB, userCajero, 'document.read')).toBe(false);
    });
  });

  describe('2FA TOTP — enrolamiento (docs/05 §6)', () => {
    it('persiste el secreto CIFRADO y se activa con un código válido', async () => {
      const { base32, otpauthUri } = await seguridad.iniciarEnrolamiento(userContador);
      expect(otpauthUri).toContain('otpauth://totp/ContaVE:contador%40a.com');

      // El secreto guardado NO es el base32 en claro (cifrado at-rest, regla 14).
      const [fila] = await tdb.ownerSql`select totp_secret, totp_enabled from users where id = ${userContador}`;
      expect(fila?.totp_secret).toMatch(/^v1:/);
      expect(fila?.totp_secret).not.toContain(base32);
      expect(fila?.totp_enabled).toBe(false);

      // Confirmar con el código del autenticador en un instante fijo.
      const ahora = new Date('2026-06-19T12:00:00.000Z');
      const codigo = totp(decodificarBase32(base32), ahora.getTime());
      await seguridad.confirmarEnrolamiento(userContador, codigo, ahora);

      const estado = await seguridad.estado(userContador);
      expect(estado.totpHabilitado).toBe(true);
      expect(estado.totpConfirmadoEn).not.toBeNull();

      // Verificación de login con el mismo instante.
      expect(await seguridad.verificar(userContador, codigo, ahora)).toBe(true);
      expect(await seguridad.verificar(userContador, '000000', ahora)).toBe(false);
    });

    it('rechaza un código inválido y no activa el 2FA', async () => {
      await seguridad.iniciarEnrolamiento(userOwner);
      await expect(seguridad.confirmarEnrolamiento(userOwner, '000000')).rejects.toThrow();
      const estado = await seguridad.estado(userOwner);
      expect(estado.totpHabilitado).toBe(false);
    });
  });
});

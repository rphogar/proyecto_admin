import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/pg-container';
import { AuditService } from '../audit/audit.service';
import type { DatabaseService } from '../db/database.service';
import { PermisosService } from '../seguridad/permisos.service';
import { runWithTenantContext, type TenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { SegregacionService } from './segregacion.service';
import { UsuariosService } from './usuarios.service';

/**
 * Integración de gestión de usuarios (P29) contra Postgres real (testcontainers): ciclo de
 * invitación (crear/aceptar, usuario nuevo y existente), invariantes de seguridad (nadie escala su
 * propio rol, el último owner no queda sin owner, transferencia de propiedad), baja que corta el
 * acceso, aislamiento por tenant (RLS), separación de deberes configurable y auditoría. Requiere
 * Docker → CI.
 */
describe('Usuarios — integración DB (P29)', () => {
  let tdb: TestDatabase;
  let usuarios: UsuariosService;
  let segregacion: SegregacionService;
  let permisos: PermisosService;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const ownerA = randomUUID();
  const adminA = randomUUID();
  const cajeroA = randomUUID();
  const ownerB = randomUUID();
  const origen = { ip: '10.0.0.9', device: 'vitest' };

  function ctx(tenantId: string, userId: string): TenantContext {
    return { tenantId, userId, ip: origen.ip, device: origen.device };
  }
  function como<T>(tenantId: string, userId: string, fn: () => Promise<T>): Promise<T> {
    return runWithTenantContext(ctx(tenantId, userId), fn);
  }

  beforeAll(async () => {
    tdb = await createTestDatabase();
    const database = { db: tdb.appDb } as DatabaseService;
    const audit = new AuditService();
    permisos = new PermisosService(database);
    segregacion = new SegregacionService(database, audit);
    usuarios = new UsuariosService(database, audit, permisos);

    await tdb.ownerSql`insert into tenants (id, nombre, slug) values
      (${tenantA}, 'Tenant A', 'tenant-a-p29'),
      (${tenantB}, 'Tenant B', 'tenant-b-p29')`;
    await tdb.ownerSql`insert into users (id, email, nombre, status, email_verified) values
      (${ownerA}, 'owner-a@p29.com', 'Owner A', 'active', true),
      (${adminA}, 'admin-a@p29.com', 'Admin A', 'active', true),
      (${cajeroA}, 'cajero-a@p29.com', 'Cajero A', 'active', true),
      (${ownerB}, 'owner-b@p29.com', 'Owner B', 'active', true)`;
    await tdb.ownerSql`insert into memberships (tenant_id, user_id, role) values
      (${tenantA}, ${ownerA}, 'owner'),
      (${tenantA}, ${adminA}, 'admin'),
      (${tenantA}, ${cajeroA}, 'cajero'),
      (${tenantB}, ${ownerB}, 'owner')`;
  }, 180_000);

  afterAll(async () => {
    await tdb.stop();
  });

  describe('ciclo de invitación', () => {
    it('invita un email nuevo, lo acepta creando el usuario y abre la membresía activa', async () => {
      const { tokenDev } = await como(tenantA, ownerA, () =>
        usuarios.invitar('nuevo@p29.com', 'contador'),
      );
      expect(tokenDev).toBeTruthy();

      const pendientes = await como(tenantA, ownerA, () => usuarios.listarInvitaciones());
      expect(pendientes.map((i) => i.email)).toContain('nuevo@p29.com');

      const res = await usuarios.aceptarInvitacion(
        tokenDev!,
        { nombre: 'Nuevo Contador', password: 'Clave-Demo-12345' },
        origen,
      );
      expect(res).toEqual({ tenantId: tenantA, rol: 'contador' });

      const [u] = await tdb.ownerSql<{ id: string; email_verified: boolean }[]>`
        select id, email_verified from users where email = 'nuevo@p29.com'`;
      expect(u?.email_verified).toBe(true);
      const [m] = await tdb.ownerSql<{ role: string; status: string }[]>`
        select role, status from memberships where tenant_id = ${tenantA} and user_id = ${u!.id}`;
      expect(m).toMatchObject({ role: 'contador', status: 'active' });
      const [inv] = await tdb.ownerSql<{ estado: string }[]>`
        select estado from invitations where email = 'nuevo@p29.com'`;
      expect(inv?.estado).toBe('accepted');
    });

    it('invita un usuario YA existente: solo vincula la membresía (sin pedir contraseña)', async () => {
      // ownerB ya es usuario (owner de tenantB); se le invita a tenantA como vendedor.
      const { tokenDev } = await como(tenantA, ownerA, () =>
        usuarios.invitar('owner-b@p29.com', 'vendedor'),
      );
      const res = await usuarios.aceptarInvitacion(tokenDev!, {}, origen);
      expect(res).toEqual({ tenantId: tenantA, rol: 'vendedor' });

      const [m] = await tdb.ownerSql<{ role: string; status: string }[]>`
        select role, status from memberships where tenant_id = ${tenantA} and user_id = ${ownerB}`;
      expect(m).toMatchObject({ role: 'vendedor', status: 'active' });
    });

    it('rechaza una segunda invitación pendiente para el mismo email (única viva)', async () => {
      await como(tenantA, ownerA, () => usuarios.invitar('doble@p29.com', 'cajero'));
      await expect(
        como(tenantA, ownerA, () => usuarios.invitar('doble@p29.com', 'cajero')),
      ).rejects.toMatchObject({ response: { codigo: 'INVITACION_DUPLICADA' } });
    });

    it('una invitación revocada o vencida no se puede aceptar', async () => {
      const { tokenDev, invitationId } = await como(tenantA, ownerA, () =>
        usuarios.invitar('revocada@p29.com', 'cajero'),
      );
      await como(tenantA, ownerA, () => usuarios.revocarInvitacion(invitationId));
      await expect(usuarios.aceptarInvitacion(tokenDev!, {}, origen)).rejects.toMatchObject({
        response: { codigo: 'INVITACION_INVALIDA' },
      });

      const venc = await como(tenantA, ownerA, () => usuarios.invitar('vencida@p29.com', 'cajero'));
      const futuro = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
      await expect(
        usuarios.aceptarInvitacion(venc.tokenDev!, { password: 'Clave-Demo-12345' }, origen, futuro),
      ).rejects.toMatchObject({ response: { codigo: 'INVITACION_INVALIDA' } });
    });
  });

  describe('roles y RBAC', () => {
    it('caso 54 — el cajero NO tiene usuario.gestionar pero sí usuario.ver (seed 0076)', async () => {
      expect(await permisos.puede(tenantA, cajeroA, 'usuario.gestionar')).toBe(false);
      expect(await permisos.puede(tenantA, cajeroA, 'usuario.ver')).toBe(true);
      expect(await permisos.puede(tenantA, ownerA, 'usuario.gestionar')).toBe(true);
    });

    it('el catálogo de roles expone la matriz de permisos para el visor', async () => {
      const cat = await usuarios.catalogoRoles();
      expect(cat.roles.map((r) => r.code)).toContain('owner');
      expect(cat.matriz.cajero).toContain('usuario.ver');
      expect(cat.matriz.cajero).not.toContain('usuario.gestionar');
    });

    it('nadie escala su propio rol y el rol owner no se reasigna libremente', async () => {
      const miembros = await como(tenantA, ownerA, () => usuarios.listarMiembros());
      const propio = miembros.find((m) => m.userId === ownerA)!;
      await expect(
        como(tenantA, ownerA, () => usuarios.reasignarRol(propio.membershipId, 'admin')),
      ).rejects.toMatchObject({ response: { codigo: 'AUTO_ESCALADA' } });

      // No se puede invitar/reasignar al rol owner (es por transferencia).
      await expect(
        como(tenantA, ownerA, () => usuarios.invitar('jefe@p29.com', 'owner' as never)),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('baja, reactivación y transferencia de propiedad', () => {
    it('al desactivar una membresía se corta el acceso y se revoca su sesión', async () => {
      // adminA tiene una sesión viva en tenantA.
      const fam = randomUUID();
      await tdb.ownerSql`insert into refresh_tokens (user_id, tenant_id, family_id, token_hash, expires_at)
        values (${adminA}, ${tenantA}, ${fam}, ${'hash-' + fam}, now() + interval '7 days')`;

      const miembros = await como(tenantA, ownerA, () => usuarios.listarMiembros());
      const mAdmin = miembros.find((m) => m.userId === adminA)!;
      await como(tenantA, ownerA, () => usuarios.desactivar(mAdmin.membershipId));

      expect(await permisos.rolDelActor(tenantA, adminA)).toBeNull();
      const [rt] = await tdb.ownerSql<{ revoked_at: Date | null }[]>`
        select revoked_at from refresh_tokens where token_hash = ${'hash-' + fam}`;
      expect(rt?.revoked_at).not.toBeNull();

      // Reactivar restaura el acceso.
      await como(tenantA, ownerA, () => usuarios.reactivar(mAdmin.membershipId));
      expect(await permisos.rolDelActor(tenantA, adminA)).toBe('admin');
    });

    it('no se puede desactivar al ÚNICO owner activo', async () => {
      const miembros = await como(tenantA, ownerA, () => usuarios.listarMiembros());
      const mOwner = miembros.find((m) => m.userId === ownerA)!;
      // adminA (otro actor) intenta desactivar al único owner → ULTIMO_OWNER.
      await expect(
        como(tenantA, adminA, () => usuarios.desactivar(mOwner.membershipId)),
      ).rejects.toMatchObject({ response: { codigo: 'ULTIMO_OWNER' } });
    });

    it('la transferencia de propiedad cede el owner y siempre deja ≥1 owner', async () => {
      const miembros = await como(tenantA, ownerA, () => usuarios.listarMiembros());
      const mAdmin = miembros.find((m) => m.userId === adminA)!;
      await como(tenantA, ownerA, () => usuarios.transferirPropiedad(mAdmin.membershipId));

      expect(await permisos.rolDelActor(tenantA, adminA)).toBe('owner');
      expect(await permisos.rolDelActor(tenantA, ownerA)).toBe('admin');
      const filasOwners = await tdb.ownerSql<{ owners: number }[]>`
        select count(*)::int as owners from memberships
        where tenant_id = ${tenantA} and role = 'owner' and status = 'active'`;
      expect(filasOwners[0]!.owners).toBeGreaterThanOrEqual(1);

      // Solo un owner puede transferir: el ex-owner (ahora admin) ya no puede.
      await expect(
        como(tenantA, ownerA, () => usuarios.transferirPropiedad(mAdmin.membershipId)),
      ).rejects.toMatchObject({ response: { codigo: 'SOLO_OWNER' } });

      // Restaurar el estado para no afectar otros tests del bloque.
      await como(tenantA, adminA, () => usuarios.transferirPropiedad(miembros.find((m) => m.userId === ownerA)!.membershipId));
    });
  });

  describe('aislamiento por tenant (RLS)', () => {
    it('las invitaciones de un tenant no son visibles ni gestionables desde otro', async () => {
      await como(tenantA, ownerA, () => usuarios.invitar('aislada@p29.com', 'cajero'));
      const desdeB = await como(tenantB, ownerB, () => usuarios.listarInvitaciones());
      expect(desdeB.map((i) => i.email)).not.toContain('aislada@p29.com');

      // Una membresía de tenantA no se ve desde tenantB (404 al intentar operarla).
      const miembrosA = await como(tenantA, ownerA, () => usuarios.listarMiembros());
      const cualquiera = miembrosA[0]!;
      await expect(
        como(tenantB, ownerB, () => usuarios.reasignarRol(cualquiera.membershipId, 'cajero')),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('separación de deberes configurable', () => {
    it('activa por defecto (sin fila) y desactivable por tenant', async () => {
      const mismo = randomUUID();
      // Default seguro: ausencia de fila ⇒ regla activa ⇒ creador = actor bloquea.
      await expect(
        como(tenantA, ownerA, () =>
          withTenant(tdb.appDb, (tx) =>
            segregacion.exigirDistinto(tx, 'nomina.aprobar_distinto_creador', mismo, mismo),
          ),
        ),
      ).rejects.toMatchObject({ status: 403 });

      await como(tenantA, ownerA, () =>
        segregacion.configurar('nomina.aprobar_distinto_creador', false),
      );

      // Desactivada: ya no bloquea aunque creador = actor.
      await expect(
        como(tenantA, ownerA, () =>
          withTenant(tdb.appDb, (tx) =>
            segregacion.exigirDistinto(tx, 'nomina.aprobar_distinto_creador', mismo, mismo),
          ),
        ),
      ).resolves.toBeUndefined();

      const estado = await como(tenantA, ownerA, () => segregacion.listar());
      expect(estado.find((r) => r.regla === 'nomina.aprobar_distinto_creador')?.activo).toBe(false);
    });
  });

  describe('auditoría', () => {
    it('cada acción de gestión deja un evento en audit_events', async () => {
      await como(tenantA, ownerA, () => usuarios.invitar('auditada@p29.com', 'cajero'));
      const eventos = await tdb.ownerSql<{ accion: string }[]>`
        select accion from audit_events
        where tenant_id = ${tenantA} and accion = 'usuario.invitar' limit 1`;
      expect(eventos[0]?.accion).toBe('usuario.invitar');
    });
  });
});

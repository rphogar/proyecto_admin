import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { instanteCaracasISO } from '@contave/shared';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { auditEvents, invitations, memberships, refreshTokens, tenants, users } from '../db/schema';
import { hashPassword } from '../seguridad/password';
import { type CatalogoRbac, PermisosService } from '../seguridad/permisos.service';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { generarRefreshToken, hashRefreshToken } from '../auth/tokens-sesion';

/** Roles que se pueden invitar/reasignar libremente. `owner` se excluye: solo por transferencia. */
export const ROLES_ASIGNABLES = ['admin', 'contador', 'cajero', 'vendedor', 'auditor'] as const;
export type RolAsignable = (typeof ROLES_ASIGNABLES)[number];

/** Vigencia de una invitación (7 días), como el refresh; configurable por entorno. */
const TTL_INVITACION_MS = 7 * 24 * 60 * 60 * 1000;

const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Origen de la petición para auditar la aceptación (que es pre-tenant, sin contexto). */
export interface OrigenPeticion {
  ip: string | undefined;
  device: string | undefined;
}

export interface MiembroDto {
  membershipId: string;
  userId: string;
  email: string;
  nombre: string;
  rol: string;
  status: string;
  createdAt: Date;
}

export interface InvitacionDto {
  id: string;
  email: string;
  rol: string;
  estado: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Gestión de usuarios por tenant/empresa (P29, docs/05 §6, docs/06 M12). Invitaciones por email con
 * rol, reasignación de rol, baja/reactivación de membresías y transferencia de propiedad, con las
 * invariantes de seguridad: **nadie escala su propio rol**, **el último owner no queda sin owner** y
 * **aislamiento por tenant** (todo bajo `withTenant`/RLS). Cada cambio deja `audit_events`.
 *
 * La ACEPTACIÓN de invitación es PRE-tenant (el invitado aún no pertenece al tenant): se resuelve por
 * el `token_hash` fijando el GUC `app.invitation_token` (políticas de 0074), creando o vinculando el
 * `user` y abriendo recién ahí la `membership` activa.
 */
@Injectable()
export class UsuariosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly permisos: PermisosService,
  ) {}

  // ── Lecturas ────────────────────────────────────────────────────────────────────────────────

  /** Miembros del tenant en contexto (membresía + identidad). */
  async listarMiembros(): Promise<MiembroDto[]> {
    return withTenant(this.database.db, async (tx) => {
      const filas = await tx
        .select({
          membershipId: memberships.id,
          userId: users.id,
          email: users.email,
          nombre: users.nombre,
          rol: memberships.role,
          status: memberships.status,
          createdAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .orderBy(memberships.createdAt);
      return filas;
    });
  }

  /** Invitaciones pendientes (vivas) del tenant. */
  async listarInvitaciones(): Promise<InvitacionDto[]> {
    return withTenant(this.database.db, async (tx) => {
      return tx
        .select({
          id: invitations.id,
          email: invitations.email,
          rol: invitations.role,
          estado: invitations.estado,
          expiresAt: invitations.expiresAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .where(eq(invitations.estado, 'pending'))
        .orderBy(invitations.createdAt);
    });
  }

  /** Catálogo RBAC (roles, permisos, matriz) para el visor de permisos por rol. */
  async catalogoRoles(): Promise<CatalogoRbac> {
    return this.permisos.catalogo();
  }

  // ── Invitaciones ──────────────────────────────────────────────────────────────────────────────

  /**
   * Invita un email con un rol al tenant en contexto. Genera un token opaco (hash en DB) y deja la
   * invitación `pending`. Devuelve el token en claro SOLO en dev (sin mailer todavía). 409 si el
   * email ya es miembro o ya tiene una invitación viva.
   */
  async invitar(
    email: string,
    rol: RolAsignable,
    ahora: Date = new Date(),
  ): Promise<{ invitationId: string; tokenDev?: string }> {
    const correo = normalizarEmail(email);
    exigirRolAsignable(rol);
    const token = generarRefreshToken();

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();

      // ¿Ya es miembro activo del tenant?
      const [usuario] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, correo))
        .limit(1);
      if (usuario !== undefined) {
        const [m] = await tx
          .select({ status: memberships.status })
          .from(memberships)
          .where(eq(memberships.userId, usuario.id))
          .limit(1);
        if (m !== undefined && m.status === 'active') {
          throw new ConflictException({
            codigo: 'YA_ES_MIEMBRO',
            message: 'Ese usuario ya tiene una membresía activa en la empresa',
          });
        }
      }

      // ¿Ya hay una invitación viva? (el índice parcial único lo garantiza; chequeo amable antes).
      const [pendiente] = await tx
        .select({ id: invitations.id })
        .from(invitations)
        .where(and(eq(invitations.email, correo), eq(invitations.estado, 'pending')))
        .limit(1);
      if (pendiente !== undefined) {
        throw new ConflictException({
          codigo: 'INVITACION_DUPLICADA',
          message: 'Ya existe una invitación pendiente para ese email',
        });
      }

      const [inv] = await tx
        .insert(invitations)
        .values({
          tenantId: ctx.tenantId,
          email: correo,
          role: rol,
          tokenHash: token.hash,
          estado: 'pending',
          invitedBy: ctx.userId ?? null,
          expiresAt: new Date(ahora.getTime() + TTL_INVITACION_MS),
        })
        .returning({ id: invitations.id });

      await this.audit.registrar(tx, {
        accion: 'usuario.invitar',
        entidad: 'invitations',
        entidadId: inv!.id,
        after: { email: correo, rol },
      });

      // TODO(email): enviar el enlace de invitación por correo cuando exista el mailer. Hasta
      // entonces, en desarrollo se devuelve el token para poder probar el flujo (nunca en prod).
      if (process.env.NODE_ENV !== 'production') {
        return { invitationId: inv!.id, tokenDev: token.valor };
      }
      return { invitationId: inv!.id };
    });
  }

  /** Revoca una invitación pendiente del tenant. */
  async revocarInvitacion(invitationId: string): Promise<void> {
    await withTenant(this.database.db, async (tx) => {
      const [inv] = await tx
        .select({ id: invitations.id, email: invitations.email, estado: invitations.estado })
        .from(invitations)
        .where(eq(invitations.id, invitationId))
        .limit(1);
      if (inv === undefined) {
        throw new NotFoundException('Invitación no encontrada');
      }
      if (inv.estado !== 'pending') {
        throw new BadRequestException(`La invitación no está pendiente (estado ${inv.estado})`);
      }
      await tx
        .update(invitations)
        .set({ estado: 'revoked' })
        .where(eq(invitations.id, invitationId));
      await this.audit.registrar(tx, {
        accion: 'usuario.invitacion_revocar',
        entidad: 'invitations',
        entidadId: invitationId,
        before: { email: inv.email, estado: inv.estado },
        after: { estado: 'revoked' },
      });
    });
  }

  // ── Roles y estado de membresías ────────────────────────────────────────────────────────────

  /** Reasigna el rol de una membresía. Nadie cambia su propio rol; `owner` solo por transferencia. */
  async reasignarRol(membershipId: string, rol: RolAsignable): Promise<void> {
    exigirRolAsignable(rol);
    await withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const m = await cargarMembresia(tx, membershipId);
      if (m.userId === ctx.userId) {
        throw new ForbiddenException({
          codigo: 'AUTO_ESCALADA',
          message: 'No podés cambiar tu propio rol',
        });
      }
      if (m.role === 'owner') {
        throw new ForbiddenException({
          codigo: 'OWNER_INMUTABLE',
          message: 'El rol owner se cambia con la transferencia de propiedad, no acá',
        });
      }
      await tx.update(memberships).set({ role: rol }).where(eq(memberships.id, membershipId));
      await this.audit.registrar(tx, {
        accion: 'usuario.rol_reasignar',
        entidad: 'memberships',
        entidadId: membershipId,
        before: { rol: m.role },
        after: { rol },
      });
    });
  }

  /** Desactiva una membresía y corta su sesión viva. No te desactivás a vos mismo; ni al último owner. */
  async desactivar(membershipId: string): Promise<void> {
    await withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      const m = await cargarMembresia(tx, membershipId);
      if (m.userId === ctx.userId) {
        throw new ForbiddenException({
          codigo: 'AUTO_BAJA',
          message: 'No podés desactivar tu propia membresía',
        });
      }
      if (m.status !== 'active') {
        throw new BadRequestException(`La membresía no está activa (estado ${m.status})`);
      }
      if (m.role === 'owner' && (await contarOwnersActivos(tx)) <= 1) {
        throw new BadRequestException({
          codigo: 'ULTIMO_OWNER',
          message: 'No se puede desactivar al único owner; transferí la propiedad primero',
        });
      }
      await tx
        .update(memberships)
        .set({ status: 'disabled' })
        .where(eq(memberships.id, membershipId));
      // Cortar la sesión viva de ese usuario en este tenant (refresh_tokens es global).
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.userId, m.userId),
            eq(refreshTokens.tenantId, ctx.tenantId),
            isNull(refreshTokens.revokedAt),
          ),
        );
      await this.audit.registrar(tx, {
        accion: 'usuario.desactivar',
        entidad: 'memberships',
        entidadId: membershipId,
        before: { status: 'active' },
        after: { status: 'disabled' },
      });
    });
  }

  /** Reactiva una membresía dada de baja. */
  async reactivar(membershipId: string): Promise<void> {
    await withTenant(this.database.db, async (tx) => {
      const m = await cargarMembresia(tx, membershipId);
      if (m.status === 'active') {
        throw new BadRequestException('La membresía ya está activa');
      }
      await tx
        .update(memberships)
        .set({ status: 'active' })
        .where(eq(memberships.id, membershipId));
      await this.audit.registrar(tx, {
        accion: 'usuario.reactivar',
        entidad: 'memberships',
        entidadId: membershipId,
        before: { status: m.status },
        after: { status: 'active' },
      });
    });
  }

  /**
   * Transfiere la propiedad: solo un `owner` puede cederla. El destino pasa a `owner` y el owner
   * actor baja a `admin`, en una transacción, garantizando que siempre quede ≥1 owner activo.
   */
  async transferirPropiedad(membershipDestino: string): Promise<void> {
    await withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      if (ctx.userId === undefined) {
        throw new UnauthorizedException('Se requiere autenticación');
      }
      const [actor] = await tx
        .select({ id: memberships.id, role: memberships.role, status: memberships.status })
        .from(memberships)
        .where(eq(memberships.userId, ctx.userId))
        .limit(1);
      if (actor === undefined || actor.role !== 'owner' || actor.status !== 'active') {
        throw new ForbiddenException({
          codigo: 'SOLO_OWNER',
          message: 'Solo un owner puede transferir la propiedad',
        });
      }
      const destino = await cargarMembresia(tx, membershipDestino);
      if (destino.userId === ctx.userId) {
        throw new BadRequestException('Ya sos el owner');
      }
      if (destino.status !== 'active') {
        throw new BadRequestException('La membresía destino debe estar activa');
      }
      await tx.update(memberships).set({ role: 'owner' }).where(eq(memberships.id, destino.id));
      await tx.update(memberships).set({ role: 'admin' }).where(eq(memberships.id, actor.id));
      await this.audit.registrar(tx, {
        accion: 'usuario.transferir_propiedad',
        entidad: 'memberships',
        entidadId: destino.id,
        before: { ownerSaliente: ctx.userId, ownerEntrante: destino.userId, rolDestinoPrevio: destino.role },
        after: { ownerEntrante: destino.userId, rolOwnerSaliente: 'admin' },
      });
    });
  }

  // ── Aceptación de invitación (PRE-tenant) ──────────────────────────────────────────────────────

  /** Datos públicos de una invitación para la pantalla de aceptación (resuelta por token). */
  async peekInvitacion(
    token: string,
    ahora: Date = new Date(),
  ): Promise<{ email: string; rol: string; empresa: string; requiereRegistro: boolean }> {
    const tokenHash = hashRefreshToken(token);
    return this.database.db.transaction(async (tx) => {
      await fijarTokenInvitacion(tx, tokenHash);
      const inv = await cargarInvitacionViva(tx, tokenHash, ahora);
      const [empresa] = await tx
        .select({ nombre: tenants.nombre })
        .from(tenants)
        .where(eq(tenants.id, inv.tenantId))
        .limit(1);
      const [usuario] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, inv.email))
        .limit(1);
      return {
        email: inv.email,
        rol: inv.role,
        empresa: empresa?.nombre ?? 'Empresa',
        requiereRegistro: usuario === undefined,
      };
    });
  }

  /**
   * Acepta una invitación: valida el token, crea (con contraseña) o vincula el `user`, lo marca
   * `email_verified` y abre la `membership` activa con el rol invitado. Idempotencia: una invitación
   * `pending` y no vencida; al consumirse pasa a `accepted`.
   */
  async aceptarInvitacion(
    token: string,
    datos: { nombre?: string | undefined; password?: string | undefined },
    origen: OrigenPeticion,
    ahora: Date = new Date(),
  ): Promise<{ tenantId: string; rol: string }> {
    const tokenHash = hashRefreshToken(token);
    return this.database.db.transaction(async (tx) => {
      await fijarTokenInvitacion(tx, tokenHash);
      const inv = await cargarInvitacionViva(tx, tokenHash, ahora);

      // Crear o vincular el usuario (identidad global, sin RLS).
      const [existente] = await tx
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.email, inv.email))
        .limit(1);

      let userId: string;
      if (existente === undefined) {
        const password = (datos.password ?? '').trim();
        if (password.length < 8) {
          throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
        }
        const nombre = (datos.nombre ?? '').trim() || inv.email;
        const [creado] = await tx
          .insert(users)
          .values({
            email: inv.email,
            nombre,
            passwordHash: await hashPassword(password),
            emailVerified: true,
          })
          .returning({ id: users.id });
        userId = creado!.id;
      } else {
        userId = existente.id;
        await tx.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
      }

      // Consumir la invitación (política de UPDATE por token de 0074).
      await tx
        .update(invitations)
        .set({ estado: 'accepted', acceptedAt: ahora, acceptedUserId: userId })
        .where(eq(invitations.id, inv.id));

      // Abrir/reactivar la membresía en el tenant de la invitación (a partir de acá, contexto tenant).
      await tx.execute(sql`select set_config('app.tenant_id', ${inv.tenantId}, true)`);
      const [membresia] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.tenantId, inv.tenantId), eq(memberships.userId, userId)))
        .limit(1);
      if (membresia === undefined) {
        await tx
          .insert(memberships)
          .values({ tenantId: inv.tenantId, userId, role: inv.role, status: 'active' });
      } else {
        await tx
          .update(memberships)
          .set({ role: inv.role, status: 'active' })
          .where(eq(memberships.id, membresia.id));
      }

      // Auditoría: la aceptación es pre-tenant (sin contexto de petición), así que se inserta el
      // evento a mano con el tenant de la invitación y el actor recién resuelto.
      await tx.insert(auditEvents).values({
        tenantId: inv.tenantId,
        actorUserId: userId,
        accion: 'usuario.invitacion_aceptar',
        entidad: 'memberships',
        entidadId: inv.id,
        after: { email: inv.email, rol: inv.role, usuarioNuevo: existente === undefined },
        tsUtc: ahora,
        tsCaracas: instanteCaracasISO(ahora),
        ip: origen.ip ?? null,
        device: origen.device ?? null,
      });

      return { tenantId: inv.tenantId, rol: inv.role };
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

function normalizarEmail(email: string): string {
  const correo = email.trim().toLowerCase();
  if (!PATRON_EMAIL.test(correo)) {
    throw new BadRequestException(`Email inválido: "${email}"`);
  }
  return correo;
}

function exigirRolAsignable(rol: string): asserts rol is RolAsignable {
  if (!(ROLES_ASIGNABLES as readonly string[]).includes(rol)) {
    throw new BadRequestException(
      `Rol inválido: "${rol}" (use ${ROLES_ASIGNABLES.join(', ')}; owner es por transferencia)`,
    );
  }
}

interface MembresiaCargada {
  id: string;
  userId: string;
  role: string;
  status: string;
}

/** Carga una membresía del tenant en contexto (RLS) o lanza 404. */
async function cargarMembresia(tx: DatabaseTx, membershipId: string): Promise<MembresiaCargada> {
  const [m] = await tx
    .select({
      id: memberships.id,
      userId: memberships.userId,
      role: memberships.role,
      status: memberships.status,
    })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1);
  if (m === undefined) {
    throw new NotFoundException('Membresía no encontrada');
  }
  return m;
}

/** Cuenta owners activos del tenant en contexto. */
async function contarOwnersActivos(tx: DatabaseTx): Promise<number> {
  const filas = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.role, 'owner'), eq(memberships.status, 'active')));
  return filas.length;
}

/** Fija el GUC `app.invitation_token` (LOCAL a la tx) para las políticas de aceptación de 0074. */
async function fijarTokenInvitacion(tx: DatabaseTx, tokenHash: string): Promise<void> {
  await tx.execute(sql`select set_config('app.invitation_token', ${tokenHash}, true)`);
}

interface InvitacionViva {
  id: string;
  tenantId: string;
  email: string;
  role: string;
}

/** Resuelve una invitación `pending` y no vencida por su token, o lanza 401. */
async function cargarInvitacionViva(
  tx: DatabaseTx,
  tokenHash: string,
  ahora: Date,
): Promise<InvitacionViva> {
  const [inv] = await tx
    .select({
      id: invitations.id,
      tenantId: invitations.tenantId,
      email: invitations.email,
      role: invitations.role,
      estado: invitations.estado,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);
  if (inv === undefined || inv.estado !== 'pending' || inv.expiresAt.getTime() <= ahora.getTime()) {
    throw new UnauthorizedException({
      codigo: 'INVITACION_INVALIDA',
      message: 'Invitación inválida, revocada o expirada',
    });
  }
  return { id: inv.id, tenantId: inv.tenantId, email: inv.email, role: inv.role };
}

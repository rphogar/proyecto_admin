import { NotFoundException } from '@nestjs/common';
import { type AnyPgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import type { DatabaseTx } from '../db/database.service';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { asegurarEmpresaDelTenant } from './companias';
import { requireUuid } from './validacion';

/**
 * Descripción de un maestro company-scoped para la base CRUD genérica. Captura lo que cambia entre
 * entidades (tabla, columnas clave, acción de auditoría y los parsers de entrada) y deja a
 * `CrudMaestroService` la mecánica común: `withTenant` (RLS), verificación de empresa del tenant,
 * desnormalización de `tenant_id`/`company_id` y evento de auditoría por escritura (regla 5).
 *
 * `Fila` es `tabla.$inferSelect`; `ValoresCrear` son los campos propios (sin tenant/company/id) que
 * el parser arma desde el body ya validado.
 */
export interface MaestroDef<ValoresCrear> {
  tabla: PgTable;
  /** Nombre de la entidad para `audit_events` (= nombre de la tabla). */
  entidad: string;
  /** Prefijo de acción de auditoría: 'item' → item.crear/actualizar/eliminar. */
  accion: string;
  idCol: AnyPgColumn;
  companyCol: AnyPgColumn;
  /** Columna de orden del listado (p.ej. nombre/sku/codigo). */
  ordenCol: AnyPgColumn;
  /** Valida el body de alta y devuelve `{ companyId, valores }` (valores = campos propios). */
  parseCrear: (body: unknown) => { companyId: string; valores: ValoresCrear };
  /** Valida el body de edición y devuelve solo los campos presentes. */
  parseActualizar: (body: unknown) => Partial<ValoresCrear>;
  /**
   * Validación de integridad adicional dentro de la transacción (p.ej. que `cuenta_id`/`item_id`
   * pertenezcan a la empresa). Recibe el companyId ya verificado.
   */
  validarReferencias?: (tx: DatabaseTx, companyId: string, valores: Partial<ValoresCrear>) => Promise<void>;
}

/** CRUD genérico de un maestro company-scoped (P5). Una instancia por entidad. */
export abstract class CrudMaestroService<Fila extends Record<string, unknown>, ValoresCrear> {
  protected constructor(
    protected readonly database: DatabaseService,
    protected readonly audit: AuditService,
    private readonly def: MaestroDef<ValoresCrear>,
  ) {}

  async listar(companyId: string): Promise<Fila[]> {
    const id = requireUuid(companyId, 'companyId');
    const filas = await withTenant(this.database.db, (tx) =>
      tx.select().from(this.def.tabla).where(eq(this.def.companyCol, id)).orderBy(this.def.ordenCol),
    );
    return filas as Fila[];
  }

  async obtener(id: string): Promise<Fila> {
    const uid = requireUuid(id, 'id');
    const fila = await withTenant(this.database.db, async (tx) => {
      const [f] = await tx.select().from(this.def.tabla).where(eq(this.def.idCol, uid)).limit(1);
      return f;
    });
    if (fila === undefined) {
      throw new NotFoundException(`${this.def.entidad} ${id} no encontrado`);
    }
    return fila as Fila;
  }

  async crear(body: unknown): Promise<Fila> {
    const { companyId, valores } = this.def.parseCrear(body);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      await this.def.validarReferencias?.(tx, companyId, valores);
      const ctx = requireTenantContext();
      // Todas las tablas de maestros usan las claves JS `tenantId`/`companyId` (desnormalizadas
      // para la RLS uniforme). Drizzle `.values()` usa las claves del modelo, no las de columna.
      const values = {
        tenantId: ctx.tenantId,
        companyId,
        ...(valores as Record<string, unknown>),
      };
      const [fila] = await tx
        .insert(this.def.tabla)
        .values(values as never)
        .returning();
      if (fila === undefined) {
        throw new Error(`No se pudo insertar en ${this.def.entidad}`);
      }
      await this.audit.registrar(tx, {
        accion: `${this.def.accion}.crear`,
        entidad: this.def.entidad,
        entidadId: (fila as { id: string }).id,
        after: fila,
      });
      return fila as Fila;
    });
  }

  async actualizar(id: string, body: unknown): Promise<Fila> {
    const uid = requireUuid(id, 'id');
    const cambios = this.def.parseActualizar(body);
    return withTenant(this.database.db, async (tx) => {
      const [antes] = await tx.select().from(this.def.tabla).where(eq(this.def.idCol, uid)).limit(1);
      if (antes === undefined) {
        throw new NotFoundException(`${this.def.entidad} ${id} no encontrado`);
      }
      if (Object.keys(cambios).length === 0) {
        return antes as Fila;
      }
      const companyId = (antes as { companyId: string }).companyId;
      await this.def.validarReferencias?.(tx, companyId, cambios);
      const [fila] = await tx
        .update(this.def.tabla)
        .set(cambios as never)
        .where(eq(this.def.idCol, uid))
        .returning();
      await this.audit.registrar(tx, {
        accion: `${this.def.accion}.actualizar`,
        entidad: this.def.entidad,
        entidadId: uid,
        before: antes,
        after: fila,
      });
      return fila as Fila;
    });
  }

  async eliminar(id: string): Promise<void> {
    const uid = requireUuid(id, 'id');
    await withTenant(this.database.db, async (tx) => {
      const [antes] = await tx.select().from(this.def.tabla).where(eq(this.def.idCol, uid)).limit(1);
      if (antes === undefined) {
        throw new NotFoundException(`${this.def.entidad} ${id} no encontrado`);
      }
      await tx.delete(this.def.tabla).where(eq(this.def.idCol, uid));
      await this.audit.registrar(tx, {
        accion: `${this.def.accion}.eliminar`,
        entidad: this.def.entidad,
        entidadId: uid,
        before: antes,
      });
    });
  }
}

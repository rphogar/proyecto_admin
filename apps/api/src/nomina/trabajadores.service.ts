import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { nominaTrabajadores } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import {
  asRecord,
  optionalDecimal,
  optionalInt,
  optionalString,
  requireDecimal,
  requireEnum,
  requireString,
  requireUuid,
} from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';

export type Trabajador = typeof nominaTrabajadores.$inferSelect;

const FRECUENCIAS = ['SEMANAL', 'QUINCENAL', 'MENSUAL'] as const;

/**
 * Fichas de trabajadores (P15, docs/04 §5). CRUD bajo RLS y auditado. Soporta salario mixto
 * (componente VES + componente en divisa) y overrides de la empresa. La lectura del salario es
 * sensible (permiso `salary.read`, regla 14); el enforcement por rol lo cablean los guards.
 */
@Injectable()
export class TrabajadoresService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async crear(body: unknown): Promise<Trabajador> {
    const datos = parse(body);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, datos.companyId);
      const [fila] = await tx
        .insert(nominaTrabajadores)
        .values({ tenantId: ctx.tenantId, createdBy: ctx.userId ?? null, ...datos })
        .returning();
      if (fila === undefined) throw new Error('No se pudo crear el trabajador');
      await this.audit.registrar(tx, { accion: 'nomina.trabajador_crear', entidad: 'nomina_trabajadores', entidadId: fila.id, after: fila });
      return fila;
    });
  }

  async actualizar(body: unknown): Promise<Trabajador> {
    const b = asRecord(body);
    const id = requireUuid(b.id, 'id');
    const datos = parse(body);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, datos.companyId);
      const [before] = await tx.select().from(nominaTrabajadores).where(and(eq(nominaTrabajadores.id, id), eq(nominaTrabajadores.companyId, datos.companyId))).limit(1);
      if (before === undefined) throw new Error(`El trabajador ${id} no existe en la empresa`);
      const [fila] = await tx
        .update(nominaTrabajadores)
        .set({ ...datos })
        .where(eq(nominaTrabajadores.id, id))
        .returning();
      if (fila === undefined) throw new Error('No se pudo actualizar el trabajador');
      await this.audit.registrar(tx, { accion: 'nomina.trabajador_actualizar', entidad: 'nomina_trabajadores', entidadId: id, before, after: fila });
      return fila;
    });
  }

  async listar(companyId: string): Promise<Trabajador[]> {
    const cid = requireUuid(companyId, 'companyId');
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, cid);
      return tx.select().from(nominaTrabajadores).where(eq(nominaTrabajadores.companyId, cid));
    });
  }
}

interface DatosTrabajador {
  companyId: string;
  cedula: string;
  nombre: string;
  cargo: string | null;
  fechaIngreso: string;
  fechaEgreso: string | null;
  frecuenciaPago: (typeof FRECUENCIAS)[number];
  salarioNormalMensual: string;
  salarioMonedaExtra: string | null;
  salarioMontoExtra: string | null;
  diasUtilidades: number | null;
  diasBonoVacacional: number | null;
  diasVacaciones: number | null;
  riesgoIvss: string | null;
  ariPorcentaje: string;
  cuentaPago: string | null;
  dependientes: number;
  activo: boolean;
}

function parse(body: unknown): DatosTrabajador {
  const b = asRecord(body);
  const extraMoneda = optionalString(b.salarioMonedaExtra, 'salarioMonedaExtra', 8);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    cedula: requireString(b.cedula, 'cedula', 30),
    nombre: requireString(b.nombre, 'nombre', 200),
    cargo: optionalString(b.cargo, 'cargo', 120),
    fechaIngreso: requireString(b.fechaIngreso, 'fechaIngreso', 10),
    fechaEgreso: optionalString(b.fechaEgreso, 'fechaEgreso', 10),
    frecuenciaPago: requireEnum(b.frecuenciaPago, 'frecuenciaPago', FRECUENCIAS, (s) => s.toUpperCase()),
    salarioNormalMensual: requireDecimal(b.salarioNormalMensual, 'salarioNormalMensual', true),
    salarioMonedaExtra: extraMoneda === null ? null : extraMoneda.toUpperCase(),
    salarioMontoExtra: optionalDecimal(b.salarioMontoExtra, 'salarioMontoExtra'),
    diasUtilidades: b.diasUtilidades == null ? null : optionalInt(b.diasUtilidades, 'diasUtilidades', 0, 0),
    diasBonoVacacional: b.diasBonoVacacional == null ? null : optionalInt(b.diasBonoVacacional, 'diasBonoVacacional', 0, 0),
    diasVacaciones: b.diasVacaciones == null ? null : optionalInt(b.diasVacaciones, 'diasVacaciones', 0, 0),
    riesgoIvss: optionalString(b.riesgoIvss, 'riesgoIvss', 12),
    ariPorcentaje: optionalDecimal(b.ariPorcentaje, 'ariPorcentaje') ?? '0',
    cuentaPago: optionalString(b.cuentaPago, 'cuentaPago', 60),
    dependientes: optionalInt(b.dependientes, 'dependientes', 0, 0),
    activo: b.activo === undefined ? true : b.activo === true,
  };
}

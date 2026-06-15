import { BadRequestException, Injectable } from '@nestjs/common';
import { validarFormula } from '@contave/fiscal-engine';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { nominaConceptos } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import {
  asRecord,
  optionalInt,
  optionalString,
  requireEnum,
  requireString,
  requireUuid,
} from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';

export type Concepto = typeof nominaConceptos.$inferSelect;

const TIPOS = ['ASIGNACION', 'DEDUCCION'] as const;

/**
 * Variables permitidas en las fórmulas de conceptos (scope del cálculo de recibo). La UI/servicio
 * valida que la fórmula solo use estas variables y funciones whitelisted antes de guardar.
 */
export const VARIABLES_FORMULA = [
  'salario_normal',
  'salario_integral',
  'salario_diario',
  'salario_diario_integral',
  'dias',
  'dias_periodo',
  'dias_cestaticket',
  'horas_extra',
  'salario_minimo',
  'ut',
  'cestaticket',
  'cestaticket_diario',
  'total_asignaciones',
  'total_devengado_salarial',
  'ari_porcentaje',
] as const;

/**
 * Conceptos de nómina con fórmulas seguras (P15, docs/04 §5). La fórmula se valida con
 * `validarFormula` (DSL puro, sin eval) contra {@link VARIABLES_FORMULA} antes de persistir, de modo
 * que el cálculo del recibo nunca evalúa algo arbitrario. CRUD bajo RLS y auditado.
 */
@Injectable()
export class ConceptosService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Valida una fórmula sin persistir (editor en vivo). Devuelve la lista de problemas. */
  validar(body: unknown): { valida: boolean; errores: string[] } {
    const b = asRecord(body);
    const formula = requireString(b.formula, 'formula', 1000);
    const errores = validarFormula(formula, [...VARIABLES_FORMULA]);
    return { valida: errores.length === 0, errores };
  }

  async crear(body: unknown): Promise<Concepto> {
    const datos = parse(body);
    this.exigirFormulaValida(datos.formula);
    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, datos.companyId);
      const [fila] = await tx
        .insert(nominaConceptos)
        .values({ tenantId: ctx.tenantId, createdBy: ctx.userId ?? null, ...datos })
        .returning();
      if (fila === undefined) throw new Error('No se pudo crear el concepto');
      await this.audit.registrar(tx, { accion: 'nomina.concepto_crear', entidad: 'nomina_conceptos', entidadId: fila.id, after: fila });
      return fila;
    });
  }

  async actualizar(body: unknown): Promise<Concepto> {
    const b = asRecord(body);
    const id = requireUuid(b.id, 'id');
    const datos = parse(body);
    this.exigirFormulaValida(datos.formula);
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, datos.companyId);
      const [before] = await tx.select().from(nominaConceptos).where(and(eq(nominaConceptos.id, id), eq(nominaConceptos.companyId, datos.companyId))).limit(1);
      if (before === undefined) throw new Error(`El concepto ${id} no existe en la empresa`);
      const [fila] = await tx.update(nominaConceptos).set({ ...datos }).where(eq(nominaConceptos.id, id)).returning();
      if (fila === undefined) throw new Error('No se pudo actualizar el concepto');
      await this.audit.registrar(tx, { accion: 'nomina.concepto_actualizar', entidad: 'nomina_conceptos', entidadId: id, before, after: fila });
      return fila;
    });
  }

  async listar(companyId: string): Promise<Concepto[]> {
    const cid = requireUuid(companyId, 'companyId');
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, cid);
      return tx.select().from(nominaConceptos).where(eq(nominaConceptos.companyId, cid)).orderBy(nominaConceptos.orden);
    });
  }

  private exigirFormulaValida(formula: string): void {
    const errores = validarFormula(formula, [...VARIABLES_FORMULA]);
    if (errores.length > 0) {
      throw new BadRequestException(`Fórmula inválida: ${errores.join(' ')}`);
    }
  }
}

interface DatosConcepto {
  companyId: string;
  codigo: string;
  nombre: string;
  tipo: (typeof TIPOS)[number];
  formula: string;
  salarial: boolean;
  orden: number;
  activo: boolean;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
}

function parse(body: unknown): DatosConcepto {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    codigo: requireString(b.codigo, 'codigo', 40),
    nombre: requireString(b.nombre, 'nombre', 200),
    tipo: requireEnum(b.tipo, 'tipo', TIPOS, (s) => s.toUpperCase()),
    formula: requireString(b.formula, 'formula', 1000),
    salarial: b.salarial === true,
    orden: optionalInt(b.orden, 'orden', 0, 0),
    activo: b.activo === undefined ? true : b.activo === true,
    vigenteDesde: optionalString(b.vigenteDesde, 'vigenteDesde', 10),
    vigenteHasta: optionalString(b.vigenteHasta, 'vigenteHasta', 10),
  };
}

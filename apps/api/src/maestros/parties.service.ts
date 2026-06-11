import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type MotivoRifInvalido, validarRif } from '@contave/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { parties } from '../db/schema';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { asegurarEmpresaDelTenant } from './companias';
import {
  asRecord,
  optionalDecimal,
  optionalInt,
  optionalString,
  optionalBoolean,
  requireEnum,
  requireString,
  requireUuid,
} from './validacion';

const TIPOS = ['cliente', 'proveedor', 'ambos'] as const;
const CONDICIONES = ['ordinario', 'formal', 'especial', 'no_contribuyente'] as const;
const PCTS_RETENCION = ['75', '100'] as const;

type FilaParty = typeof parties.$inferSelect;

/** Mensaje accionable por motivo de RIF inválido (caso 16: bloqueo con explicación). */
const MENSAJE_RIF: Record<MotivoRifInvalido, string> = {
  formato_invalido: 'El RIF no tiene el formato esperado [VEJPG]-XXXXXXXX-X',
  tipo_invalido: 'El tipo de RIF debe ser V, E, J, P o G',
  digito_verificador: 'El dígito verificador del RIF no concuerda',
};

export interface CrearPartyInput {
  companyId: string;
  tipo: (typeof TIPOS)[number];
  rif: string;
  razonSocial: string;
  condicionIva: (typeof CONDICIONES)[number];
  esAgenteRetencionIva: boolean;
  pctRetencionIva: string | null;
  esAgenteRetencionIslr: boolean;
  direccionFiscal: string | null;
  email: string | null;
  telefono: string | null;
  limiteCredito: string | null;
  diasCredito: number;
  activo: boolean;
  /** Forzar el alta pese a RIF inválido (caso 16): requiere permiso y deja marca de auditoría. */
  forzarRif: boolean;
}

function parseCrear(body: unknown): CrearPartyInput {
  const b = asRecord(body);
  const esAgenteIva = optionalBoolean(b.esAgenteRetencionIva, false);
  const pct = esAgenteIva
    ? requireEnum(b.pctRetencionIva, 'pctRetencionIva', PCTS_RETENCION)
    : null;
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    tipo: requireEnum(b.tipo, 'tipo', TIPOS, (s) => s.toLowerCase()),
    rif: requireString(b.rif, 'rif', 20),
    razonSocial: requireString(b.razonSocial, 'razonSocial'),
    condicionIva: requireEnum(b.condicionIva, 'condicionIva', CONDICIONES, (s) => s.toLowerCase()),
    esAgenteRetencionIva: esAgenteIva,
    pctRetencionIva: pct,
    esAgenteRetencionIslr: optionalBoolean(b.esAgenteRetencionIslr, false),
    direccionFiscal: optionalString(b.direccionFiscal, 'direccionFiscal'),
    email: optionalString(b.email, 'email', 200),
    telefono: optionalString(b.telefono, 'telefono', 50),
    limiteCredito: optionalDecimal(b.limiteCredito, 'limiteCredito'),
    diasCredito: optionalInt(b.diasCredito, 'diasCredito', 0),
    activo: optionalBoolean(b.activo, true),
    forzarRif: optionalBoolean(b.forzarRif, false),
  };
}

/** Campos editables de un tercero (el RIF y la empresa no se mueven tras el alta). */
function parseActualizar(body: unknown): Partial<Omit<CrearPartyInput, 'companyId' | 'rif' | 'forzarRif'>> {
  const b = asRecord(body);
  const out: Partial<Omit<CrearPartyInput, 'companyId' | 'rif' | 'forzarRif'>> = {};
  if ('tipo' in b) out.tipo = requireEnum(b.tipo, 'tipo', TIPOS, (s) => s.toLowerCase());
  if ('razonSocial' in b) out.razonSocial = requireString(b.razonSocial, 'razonSocial');
  if ('condicionIva' in b)
    out.condicionIva = requireEnum(b.condicionIva, 'condicionIva', CONDICIONES, (s) => s.toLowerCase());
  if ('esAgenteRetencionIslr' in b)
    out.esAgenteRetencionIslr = optionalBoolean(b.esAgenteRetencionIslr, false);
  if ('direccionFiscal' in b) out.direccionFiscal = optionalString(b.direccionFiscal, 'direccionFiscal');
  if ('email' in b) out.email = optionalString(b.email, 'email', 200);
  if ('telefono' in b) out.telefono = optionalString(b.telefono, 'telefono', 50);
  if ('limiteCredito' in b) out.limiteCredito = optionalDecimal(b.limiteCredito, 'limiteCredito');
  if ('diasCredito' in b) out.diasCredito = optionalInt(b.diasCredito, 'diasCredito', 0);
  if ('activo' in b) out.activo = optionalBoolean(b.activo, true);
  // El par (es_agente_retencion_iva, pct) se actualiza junto para no violar el CHECK de consistencia.
  if ('esAgenteRetencionIva' in b) {
    const esAgente = optionalBoolean(b.esAgenteRetencionIva, false);
    out.esAgenteRetencionIva = esAgente;
    out.pctRetencionIva = esAgente
      ? requireEnum(b.pctRetencionIva, 'pctRetencionIva', PCTS_RETENCION)
      : null;
  }
  return out;
}

/**
 * Maestro de terceros (P5, docs/05 §3.2). Valida el RIF con `@contave/shared` (caso 16): RIF
 * inválido → 400 con explicación; `forzarRif` permite el alta dejando marca de auditoría (la
 * exigencia de permiso elevado se cableará con los guards). Todo bajo `withTenant` (RLS) y con
 * evento en `audit_events` en la misma transacción (regla 5).
 */
@Injectable()
export class PartiesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async listar(companyId: string): Promise<FilaParty[]> {
    const id = requireUuid(companyId, 'companyId');
    return withTenant(this.database.db, (tx) =>
      tx.select().from(parties).where(eq(parties.companyId, id)).orderBy(parties.razonSocial),
    );
  }

  async obtener(id: string): Promise<FilaParty> {
    const uid = requireUuid(id, 'id');
    const fila = await withTenant(this.database.db, async (tx) => {
      const [f] = await tx.select().from(parties).where(eq(parties.id, uid)).limit(1);
      return f;
    });
    if (fila === undefined) {
      throw new NotFoundException(`Tercero ${id} no encontrado`);
    }
    return fila;
  }

  async crear(body: unknown): Promise<FilaParty> {
    const input = parseCrear(body);
    const res = validarRif(input.rif);
    if (!res.valido && !input.forzarRif) {
      // caso 16: bloqueo con explicación del motivo concreto (y código para la UI).
      throw new BadRequestException({
        message: res.motivo ? MENSAJE_RIF[res.motivo] : 'RIF inválido',
        motivo: res.motivo ?? 'formato_invalido',
        regla: 'caso-16',
      });
    }
    const rifNormalizado = res.valido ? (res.normalizado as string) : input.rif.toUpperCase();

    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, input.companyId);
      const ctx = requireTenantContext();
      const [fila] = await tx
        .insert(parties)
        .values({
          tenantId: ctx.tenantId,
          companyId: input.companyId,
          tipo: input.tipo,
          rif: rifNormalizado,
          razonSocial: input.razonSocial,
          condicionIva: input.condicionIva,
          esAgenteRetencionIva: input.esAgenteRetencionIva,
          pctRetencionIva: input.pctRetencionIva,
          esAgenteRetencionIslr: input.esAgenteRetencionIslr,
          direccionFiscal: input.direccionFiscal,
          email: input.email,
          telefono: input.telefono,
          limiteCredito: input.limiteCredito,
          diasCredito: input.diasCredito,
          activo: input.activo,
        })
        .returning();
      if (fila === undefined) {
        throw new Error('No se pudo insertar el tercero');
      }
      await this.audit.registrar(tx, {
        // Si se forzó un RIF inválido, la acción lo refleja para trazabilidad (caso 16).
        accion: res.valido ? 'party.crear' : 'party.crear.rif_forzado',
        entidad: 'parties',
        entidadId: fila.id,
        after: fila,
      });
      return fila;
    });
  }

  async actualizar(id: string, body: unknown): Promise<FilaParty> {
    const uid = requireUuid(id, 'id');
    const cambios = parseActualizar(body);
    return withTenant(this.database.db, async (tx) => {
      const [antes] = await tx.select().from(parties).where(eq(parties.id, uid)).limit(1);
      if (antes === undefined) {
        throw new NotFoundException(`Tercero ${id} no encontrado`);
      }
      if (Object.keys(cambios).length === 0) {
        return antes;
      }
      const [fila] = await tx
        .update(parties)
        .set(cambios)
        .where(eq(parties.id, uid))
        .returning();
      await this.audit.registrar(tx, {
        accion: 'party.actualizar',
        entidad: 'parties',
        entidadId: uid,
        before: antes,
        after: fila,
      });
      return fila as FilaParty;
    });
  }

  async eliminar(id: string): Promise<void> {
    const uid = requireUuid(id, 'id');
    await withTenant(this.database.db, async (tx) => {
      const [antes] = await tx.select().from(parties).where(eq(parties.id, uid)).limit(1);
      if (antes === undefined) {
        throw new NotFoundException(`Tercero ${id} no encontrado`);
      }
      await tx.delete(parties).where(eq(parties.id, uid));
      await this.audit.registrar(tx, {
        accion: 'party.eliminar',
        entidad: 'parties',
        entidadId: uid,
        before: antes,
      });
    });
  }
}

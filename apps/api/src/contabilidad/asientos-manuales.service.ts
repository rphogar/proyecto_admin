import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Asiento, type EntradaLinea, LineaAsiento, postear, type ResultadoCuadre, verificarCuadre } from '@contave/ledger';
import { periodoFiscal } from '@contave/shared';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { journalEntries, manualEntryAttachments, periods } from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import {
  asRecord,
  optionalDecimal,
  optionalString,
  optionalUuid,
  requireDecimal,
  requireEnum,
  requireString,
  requireUuid,
} from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { cargarCuentas, cargarPlan, requerirPeriodoAbierto } from './contabilidad-comun';

export type JournalEntry = typeof journalEntries.$inferSelect;
export type ManualEntryAttachment = typeof manualEntryAttachments.$inferSelect;

export interface ResultadoAsientoManual {
  readonly entry: JournalEntry;
  /** True si se imputó a un período abierto distinto al de la fecha por estar cerrado (caso 42). */
  readonly redirigidoAPeriodoAbierto: boolean;
}

/**
 * Asientos manuales (P13, docs/03 §5): líneas libres, balanceadas en triple base, `sourceType=MANUAL`.
 * `validar` previsualiza el cuadre en vivo sin persistir. `crear` postea el asiento; si la fecha cae
 * en un período CERRADO se rechaza (caso 42) salvo que se reenvíe con `registrarEnPeriodoAbierto`,
 * en cuyo caso se imputa al período abierto indicado con referencia al cerrado. La autorización por
 * rol (contador/admin) se cablea con los guards de auth (regla 13; permiso `contabilidad.asiento_manual`).
 */
@Injectable()
export class AsientosManualesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Previsualiza el cuadre (ΣD=ΣC en triple base) sin persistir — editor balanceado en vivo. */
  async validar(body: unknown): Promise<ResultadoCuadre> {
    const b = asRecord(body);
    const lineas = parseLineas(b.lineas);
    try {
      return verificarCuadre(lineas.map((l) => LineaAsiento.desde(l)));
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Líneas inválidas');
    }
  }

  async crear(body: unknown): Promise<ResultadoAsientoManual> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const descripcion = requireString(b.descripcion, 'descripcion', 300);
    const fecha = parseFecha(b.fecha);
    const lineas = parseLineas(b.lineas);
    const redireccion = parseRedireccion(b.registrarEnPeriodoAbierto);

    const { anio, mes } = periodoFiscal(fecha);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);
      const plan = await cargarPlan(tx, companyId);
      const { porCodigo } = await cargarCuentas(tx, companyId);

      const delMes = await buscarPeriodo(tx, companyId, anio, mes);
      let periodId: string;
      let fechaFinal = fecha;
      let descripcionFinal = descripcion;
      let redirigido = false;

      if (delMes === undefined) {
        throw new BadRequestException(`No existe período contable ${etiqueta(anio, mes)}; créelo primero`);
      } else if (delMes.estado === 'OPEN') {
        periodId = delMes.id;
      } else {
        // Período CERRADO (caso 42): rechazar salvo redirección explícita al período abierto.
        if (redireccion === null) {
          throw new BadRequestException(
            `El período ${etiqueta(anio, mes)} está cerrado (regla 9, caso 42). Reenvíe con ` +
              `"registrarEnPeriodoAbierto": { "anio", "mes" } para imputar al período abierto con referencia al cerrado.`,
          );
        }
        periodId = await requerirPeriodoAbierto(tx, companyId, redireccion.anio, redireccion.mes);
        fechaFinal = instanteEnMes(redireccion.anio, redireccion.mes);
        descripcionFinal = `${descripcion} (ref. período cerrado ${etiqueta(anio, mes)})`;
        redirigido = true;
      }

      const id = randomUUID();
      const asiento = postear(
        Asiento.construir({ id, companyId, fecha: fechaFinal, descripcion: descripcionFinal, lineas, sourceType: 'MANUAL' }, { plan }),
      );
      await persistirAsiento(tx, asiento, { tenantId: ctx.tenantId, companyId, periodId, createdBy: ctx.userId ?? null, cuentas: porCodigo });

      const [entry] = await tx.select().from(journalEntries).where(eq(journalEntries.id, id)).limit(1);
      if (entry === undefined) throw new Error('No se pudo registrar el asiento manual');

      await this.audit.registrar(tx, { accion: 'contabilidad.asiento_manual', entidad: 'journal_entries', entidadId: id, after: entry });
      return { entry, redirigidoAPeriodoAbierto: redirigido };
    });
  }

  /** Adjunta un soporte (metadato) a un asiento manual; los bytes viven en object-store. */
  async adjuntar(body: unknown): Promise<ManualEntryAttachment> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const entryId = requireUuid(b.entryId, 'entryId');
    const nombreArchivo = requireString(b.nombreArchivo, 'nombreArchivo', 300);
    const hashArchivo = requireString(b.hashArchivo, 'hashArchivo', 128);
    const contentType = optionalString(b.contentType, 'contentType', 120);
    const storageUrl = optionalString(b.storageUrl, 'storageUrl', 600);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);

      const [entry] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, companyId))).limit(1);
      if (entry === undefined) throw new BadRequestException(`El asiento ${entryId} no existe en la empresa`);

      const [fila] = await tx
        .insert(manualEntryAttachments)
        .values({ tenantId: ctx.tenantId, companyId, entryId, nombreArchivo, contentType, hashArchivo, storageUrl, uploadedBy: ctx.userId ?? null })
        .returning();
      if (fila === undefined) throw new Error('No se pudo adjuntar el soporte');

      await this.audit.registrar(tx, { accion: 'contabilidad.asiento_adjuntar', entidad: 'manual_entry_attachments', entidadId: fila.id, after: fila });
      return fila;
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buscarPeriodo(tx: DatabaseTx, companyId: string, anio: number, mes: number): Promise<{ id: string; estado: string } | undefined> {
  const [row] = await tx
    .select({ id: periods.id, estado: periods.estado })
    .from(periods)
    .where(and(eq(periods.companyId, companyId), eq(periods.anio, anio), eq(periods.mes, mes)))
    .limit(1);
  return row;
}

function parseFecha(valor: unknown): Date {
  const s = requireString(valor, 'fecha', 40);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`fecha inválida: "${s}"`);
  return d;
}

function parseLineas(valor: unknown): EntradaLinea[] {
  if (!Array.isArray(valor) || valor.length < 2) {
    throw new BadRequestException('El asiento requiere al menos dos líneas (debe y haber)');
  }
  return valor.map((raw, i) => {
    const l = asRecord(raw);
    const partyId = optionalUuid(l.partyId, `lineas[${i}].partyId`);
    const centroCosto = optionalString(l.centroCosto, `lineas[${i}].centroCosto`, 60);
    const sucursalId = optionalUuid(l.sucursalId, `lineas[${i}].sucursalId`);
    const vencimiento = optionalString(l.vencimiento, `lineas[${i}].vencimiento`, 10);
    const linea: EntradaLinea = {
      cuenta: requireString(l.cuenta, `lineas[${i}].cuenta`, 60),
      dc: requireEnum(l.dc, `lineas[${i}].dc`, ['D', 'C'] as const, (s) => s.toUpperCase()),
      moneda: requireString(l.moneda, `lineas[${i}].moneda`, 12).toUpperCase(),
      montoOrigen: requireDecimal(l.montoOrigen, `lineas[${i}].montoOrigen`, true),
      montoVes: requireDecimal(l.montoVes, `lineas[${i}].montoVes`, true),
      montoUsdMgmt: requireDecimal(l.montoUsdMgmt, `lineas[${i}].montoUsdMgmt`, true),
      rateBcv: optionalDecimal(l.rateBcv, `lineas[${i}].rateBcv`),
      rateUsdMgmt: optionalDecimal(l.rateUsdMgmt, `lineas[${i}].rateUsdMgmt`),
      esAjuste: l.esAjuste === true,
      ...(partyId !== null ? { partyId } : {}),
      ...(centroCosto !== null ? { centroCosto } : {}),
      ...(sucursalId !== null ? { sucursalId } : {}),
      ...(vencimiento !== null ? { vencimiento } : {}),
    };
    return linea;
  });
}

function parseRedireccion(valor: unknown): { anio: number; mes: number } | null {
  if (valor === undefined || valor === null) return null;
  const r = asRecord(valor);
  const anio = Number(r.anio);
  const mes = Number(r.mes);
  if (!Number.isInteger(anio) || anio < 2000 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new BadRequestException('registrarEnPeriodoAbierto requiere { anio, mes } válidos');
  }
  return { anio, mes };
}

/** Instante UTC representativo de un mes fiscal (día 15, 16:00Z ≈ mediodía Caracas, mismo día civil). */
function instanteEnMes(anio: number, mes: number): Date {
  return new Date(Date.UTC(anio, mes - 1, 15, 16, 0, 0));
}

function etiqueta(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

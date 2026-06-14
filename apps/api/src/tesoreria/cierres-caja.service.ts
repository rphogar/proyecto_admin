import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Asiento, postear } from '@contave/ledger';
import { Decimal, fechaFiscal, periodoFiscal } from '@contave/shared';
import { and, between, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { accounts, cierreCajaArqueos, cierresCaja, cobroMedios, cobros, paymentMethods } from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalDecimal, optionalUuid, requireDecimal, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { calcularArqueo, type ConteoMetodo } from './calculo-arqueo';
import { cargarCuentas, hashIntegridad, requerirPeriodoAbierto } from './tesoreria-comun';

interface ConteoInput {
  paymentMethodId: string;
  montoDeclarado: string;
}

interface CerrarInput {
  cierreId: string;
  companyId: string;
  cierre: Date;
  rateBcv: string | null;
  rateUsdMgmt: string;
  conteos: ConteoInput[];
}

export type CierreCaja = typeof cierresCaja.$inferSelect;
export interface CierreConArqueo {
  readonly cierre: CierreCaja;
  readonly arqueos: (typeof cierreCajaArqueos.$inferSelect)[];
}

/**
 * Cierres de caja por turno con arqueo (P11, docs/06 M1/M4, caso 5). `abrir` registra el inicio del
 * turno; `cerrar` deriva del sistema lo esperado por método (de `cobro_medios` en la ventana del
 * turno — que distingue método e incluye el vuelto cruzado del caso 5), lo compara con lo declarado,
 * postea el asiento de faltante/sobrante y persiste el arqueo. El cierre CERRADO es inmutable (regla
 * 4): trigger en 0034.
 */
@Injectable()
export class CierresCajaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Abre un turno de caja (estado ABIERTO con la hora de apertura). */
  async abrir(body: unknown): Promise<CierreCaja> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const branchId = optionalUuid(b.branchId, 'branchId');
    const apertura = b.apertura == null || String(b.apertura).trim() === '' ? new Date() : new Date(String(b.apertura));
    if (Number.isNaN(apertura.getTime())) throw new BadRequestException('apertura inválida');

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);
      const [fila] = await tx
        .insert(cierresCaja)
        .values({
          tenantId: ctx.tenantId,
          companyId,
          branchId,
          apertura,
          fechaFiscal: fechaFiscal(apertura),
          status: 'ABIERTO',
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (fila === undefined) throw new Error('No se pudo abrir el turno de caja');
      await this.audit.registrar(tx, { accion: 'tesoreria.cierre_caja.abrir', entidad: 'cierres_caja', entidadId: fila.id, after: fila });
      return fila;
    });
  }

  /** Cierra un turno: arqueo por método, asiento de diferencia y bloqueo (inmutable). */
  async cerrar(body: unknown): Promise<CierreConArqueo> {
    const e = parseCerrar(body);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);

      const [cierre] = await tx
        .select()
        .from(cierresCaja)
        .where(and(eq(cierresCaja.id, e.cierreId), eq(cierresCaja.companyId, e.companyId)))
        .limit(1);
      if (cierre === undefined) throw new NotFoundException(`Cierre ${e.cierreId} no encontrado`);
      if (cierre.status === 'CERRADO') throw new BadRequestException('El turno ya está cerrado');
      if (e.cierre < cierre.apertura) throw new BadRequestException('La hora de cierre no puede ser anterior a la apertura');

      const { porCodigo } = await cargarCuentas(tx, e.companyId);
      const metodos = await cargarMetodos(tx, e.companyId);
      const esperado = await esperadoPorMetodo(tx, e.companyId, cierre.apertura, e.cierre);

      const conteos: ConteoMetodo[] = e.conteos.map((c) => {
        const pm = metodos.get(c.paymentMethodId);
        if (pm === undefined) throw new BadRequestException(`Método de pago ${c.paymentMethodId} no existe en la empresa`);
        const esVes = pm.moneda.toUpperCase() === 'VES';
        if (!esVes && e.rateBcv === null) throw new BadRequestException(`Falta rateBcv para el método en ${pm.moneda}`);
        return {
          paymentMethodId: c.paymentMethodId,
          cuenta: pm.cuenta,
          moneda: pm.moneda,
          montoSistema: (esperado.get(c.paymentMethodId) ?? new Decimal(0)).toFixed(8),
          montoDeclarado: c.montoDeclarado,
          rateBcv: esVes ? null : e.rateBcv,
        };
      });

      const sourceId = cierre.id;
      const arqueo = calcularArqueo({ fecha: e.cierre, descripcion: `Arqueo cierre de caja ${cierre.id}`, conteos, rateUsdMgmt: e.rateUsdMgmt, companyId: e.companyId, sourceId });

      let entryId: string | null = null;
      if (arqueo.entradaAsiento !== undefined) {
        const { anio, mes } = periodoFiscal(e.cierre);
        const periodId = await requerirPeriodoAbierto(tx, e.companyId, anio, mes);
        const asiento = postear(Asiento.construir(arqueo.entradaAsiento));
        entryId = await persistirAsiento(tx, asiento, { tenantId: ctx.tenantId, companyId: e.companyId, periodId, createdBy: ctx.userId ?? null, cuentas: porCodigo });
      }

      // Arqueos primero (el trigger de inmutabilidad solo bloquea UPDATE/DELETE, no INSERT).
      const arqueos = await tx
        .insert(cierreCajaArqueos)
        .values(
          arqueo.diferencias.map((d) => ({
            tenantId: ctx.tenantId,
            companyId: e.companyId,
            cierreId: cierre.id,
            paymentMethodId: d.paymentMethodId,
            moneda: d.moneda,
            montoSistema: d.montoSistema,
            montoDeclarado: d.montoDeclarado,
            diferencia: d.diferencia,
          })),
        )
        .returning();

      const hash = hashIntegridad({ cierreId: cierre.id, companyId: e.companyId, entryId, total: arqueo.totalDiferenciaVes });
      const [actualizado] = await tx
        .update(cierresCaja)
        .set({ cierre: e.cierre, journalEntryId: entryId, totalDiferenciaVes: arqueo.totalDiferenciaVes, status: 'CERRADO', hashIntegridad: hash })
        .where(eq(cierresCaja.id, cierre.id))
        .returning();
      if (actualizado === undefined) throw new Error('No se pudo cerrar el turno');

      await this.audit.registrar(tx, { accion: 'tesoreria.cierre_caja.cerrar', entidad: 'cierres_caja', entidadId: cierre.id, before: cierre, after: actualizado });
      return { cierre: actualizado, arqueos };
    });
  }

  async listar(companyId: string): Promise<CierreCaja[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(cierresCaja).where(eq(cierresCaja.companyId, companyId));
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MetodoInfo {
  cuenta: string;
  moneda: string;
}

function parseCerrar(body: unknown): CerrarInput {
  const b = asRecord(body);
  if (!Array.isArray(b.conteos) || b.conteos.length === 0) throw new BadRequestException('El cierre requiere al menos un conteo de método');
  const cierreRaw = b.cierre;
  const cierre = cierreRaw == null || String(cierreRaw).trim() === '' ? new Date() : new Date(String(cierreRaw));
  if (Number.isNaN(cierre.getTime())) throw new BadRequestException('cierre inválido');
  return {
    cierreId: requireUuid(b.cierreId, 'cierreId'),
    companyId: requireUuid(b.companyId, 'companyId'),
    cierre,
    rateBcv: optionalDecimal(b.rateBcv, 'rateBcv'),
    rateUsdMgmt: requireDecimal(b.rateUsdMgmt, 'rateUsdMgmt'),
    conteos: b.conteos.map((c, i) => {
      const r = asRecord(c);
      return { paymentMethodId: requireUuid(r.paymentMethodId, `conteos[${i}].paymentMethodId`), montoDeclarado: requireDecimal(r.montoDeclarado, `conteos[${i}].montoDeclarado`, true) };
    }),
  };
}

async function cargarMetodos(tx: DatabaseTx, companyId: string): Promise<Map<string, MetodoInfo>> {
  const filas = await tx
    .select({ id: paymentMethods.id, codigo: accounts.codigo, moneda: paymentMethods.moneda })
    .from(paymentMethods)
    .innerJoin(accounts, eq(paymentMethods.cuentaId, accounts.id))
    .where(eq(paymentMethods.companyId, companyId));
  return new Map(filas.map((f) => [f.id, { cuenta: f.codigo, moneda: f.moneda }]));
}

/** Esperado por método del sistema: Σ(medios no-vuelto) − Σ(medios vuelto) en la ventana del turno. */
async function esperadoPorMetodo(tx: DatabaseTx, companyId: string, desde: Date, hasta: Date): Promise<Map<string, Decimal>> {
  const filas = await tx
    .select({ paymentMethodId: cobroMedios.paymentMethodId, montoOrigen: cobroMedios.montoOrigen, esVuelto: cobroMedios.esVuelto })
    .from(cobroMedios)
    .innerJoin(cobros, eq(cobroMedios.cobroId, cobros.id))
    .where(and(eq(cobroMedios.companyId, companyId), between(cobros.fecha, desde, hasta)));
  const acc = new Map<string, Decimal>();
  for (const f of filas) {
    const signo = f.esVuelto ? -1 : 1;
    acc.set(f.paymentMethodId, (acc.get(f.paymentMethodId) ?? new Decimal(0)).plus(new Decimal(f.montoOrigen).times(signo)));
  }
  return acc;
}

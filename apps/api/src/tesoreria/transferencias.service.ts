import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Asiento, postear } from '@contave/ledger';
import { Decimal, fechaFiscal, periodoFiscal } from '@contave/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { companies, transferencias } from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalDecimal, optionalString, optionalUuid, requireDecimal, requireString, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import { calcularTransferencia, type EntradaTransferencia } from './calculo-transferencia';
import { cargarCuentas, hashIntegridad, requerirPeriodoAbierto } from './tesoreria-comun';

interface PataInput {
  cuentaCodigo: string;
  moneda: string;
  monto: string;
  rateBcv: string | null;
}

interface TransferenciaInput {
  companyId: string;
  branchId: string | null;
  fecha: Date;
  descripcion: string;
  origen: PataInput;
  destino: PataInput;
  rateUsdMgmt: string;
}

function parsePata(raw: unknown, campo: string): PataInput {
  const b = asRecord(raw);
  return {
    cuentaCodigo: requireString(b.cuentaCodigo, `${campo}.cuentaCodigo`, 20),
    moneda: requireString(b.moneda, `${campo}.moneda`, 8).toUpperCase(),
    monto: requireDecimal(b.monto, `${campo}.monto`),
    rateBcv: optionalDecimal(b.rateBcv, `${campo}.rateBcv`),
  };
}

function parse(body: unknown): TransferenciaInput {
  const b = asRecord(body);
  const fechaRaw = b.fecha;
  const fecha = fechaRaw == null || String(fechaRaw).trim() === '' ? new Date() : new Date(String(fechaRaw));
  if (Number.isNaN(fecha.getTime())) throw new BadRequestException(`fecha inválida: ${String(fechaRaw)}`);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    branchId: optionalUuid(b.branchId, 'branchId'),
    fecha,
    descripcion: optionalString(b.descripcion, 'descripcion') ?? 'Transferencia interna',
    origen: parsePata(b.origen, 'origen'),
    destino: parsePata(b.destino, 'destino'),
    rateUsdMgmt: requireDecimal(b.rateUsdMgmt, 'rateUsdMgmt'),
  };
}

export type TransferenciaRegistrada = typeof transferencias.$inferSelect;

/**
 * Transferencias internas entre cuentas propias (P11, docs/06 M4, docs/03 §4.2). Transacción única:
 * cálculo en triple base (con diferencial cambiario si hay conversión) → asiento POSTED → fila
 * `transferencias` → auditoría, todo bajo RLS y con período abierto. La transferencia POSTED es
 * inmutable (regla 4): las correcciones van por una transferencia de reverso.
 */
@Injectable()
export class TransferenciasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async registrar(body: unknown): Promise<TransferenciaRegistrada> {
    const e = parse(body);
    if (e.origen.cuentaCodigo === e.destino.cuentaCodigo) {
      throw new BadRequestException('La cuenta de origen y la de destino no pueden ser la misma');
    }

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, e.companyId);
      const [company] = await tx.select().from(companies).where(eq(companies.id, e.companyId)).limit(1);
      if (company === undefined) throw new NotFoundException(`Empresa ${e.companyId} no encontrada`);

      const { porCodigo } = await cargarCuentas(tx, e.companyId);
      const codOrigen = e.origen.cuentaCodigo;
      const codDestino = e.destino.cuentaCodigo;
      const idOrigen = porCodigo.get(codOrigen);
      const idDestino = porCodigo.get(codDestino);
      if (idOrigen === undefined) throw new BadRequestException(`La cuenta de origen ${codOrigen} no existe en el plan de la empresa`);
      if (idDestino === undefined) throw new BadRequestException(`La cuenta de destino ${codDestino} no existe en el plan de la empresa`);

      const transferId = randomUUID();
      const resultado = calcularTransferencia({
        fecha: e.fecha,
        descripcion: e.descripcion,
        origen: { cuenta: codOrigen, moneda: e.origen.moneda, monto: e.origen.monto, rateBcv: e.origen.rateBcv },
        destino: { cuenta: codDestino, moneda: e.destino.moneda, monto: e.destino.monto, rateBcv: e.destino.rateBcv },
        rateUsdMgmt: e.rateUsdMgmt,
        companyId: e.companyId,
        sourceId: transferId,
      } satisfies EntradaTransferencia);

      const { anio, mes } = periodoFiscal(e.fecha);
      const periodId = await requerirPeriodoAbierto(tx, e.companyId, anio, mes);
      const asiento = postear(Asiento.construir(resultado.entradaAsiento));
      const entryId = await persistirAsiento(tx, asiento, {
        tenantId: ctx.tenantId,
        companyId: e.companyId,
        periodId,
        createdBy: ctx.userId ?? null,
        cuentas: porCodigo,
      });

      const montoOrigen = new Decimal(e.origen.monto);
      const hash = hashIntegridad({ transferId, companyId: e.companyId, entryId, origen: codOrigen, destino: codDestino, montoOrigen: montoOrigen.toFixed(8) });

      const [fila] = await tx
        .insert(transferencias)
        .values({
          id: transferId,
          tenantId: ctx.tenantId,
          companyId: e.companyId,
          branchId: e.branchId,
          origenCuentaId: idOrigen,
          destinoCuentaId: idDestino,
          monedaOrigen: e.origen.moneda,
          montoOrigen: e.origen.monto,
          monedaDestino: e.destino.moneda,
          montoDestino: e.destino.monto,
          rateBcv: e.destino.rateBcv ?? e.origen.rateBcv,
          rateUsdMgmt: e.rateUsdMgmt,
          diferencialVes: resultado.diferencialVes,
          journalEntryId: entryId,
          fecha: e.fecha,
          fechaFiscal: fechaFiscal(e.fecha),
          descripcion: e.descripcion,
          hashIntegridad: hash,
          status: 'POSTED',
          createdBy: ctx.userId ?? null,
        })
        .returning();
      if (fila === undefined) throw new Error('No se pudo registrar la transferencia');

      await this.audit.registrar(tx, { accion: 'tesoreria.transfer', entidad: 'transferencias', entidadId: transferId, after: fila });
      return fila;
    });
  }

  async listar(companyId: string): Promise<TransferenciaRegistrada[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(transferencias).where(eq(transferencias.companyId, companyId));
    });
  }
}

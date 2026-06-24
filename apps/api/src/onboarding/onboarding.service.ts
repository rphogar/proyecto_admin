import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Asiento } from '@contave/ledger';
import { type MotivoRifInvalido, caracasAUtc, fechaFiscal, periodoFiscal, validarRif } from '@contave/shared';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { cargarPlan } from '../contabilidad/contabilidad-comun';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { companies, companyAperturas, stockMoves } from '../db/schema';
import { persistirAsiento } from '../documentos/persistir-asiento';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import {
  asRecord,
  optionalInt,
  optionalString,
  optionalUuid,
  requireDecimal,
  requireEnum,
  requireString,
  requireUuid,
} from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { cargarCuentas, requerirPeriodoAbierto } from '../tesoreria/tesoreria-comun';
import { withTenant } from '../tenant/with-tenant';
import { type RenglonApertura, construirAsientoApertura } from './asiento-apertura';
import { type PerfilInferido, inferirPerfilTributario } from './perfil';
import { almacenPrincipalId, asegurarPeriodoAbierto, precargarEmpresa, type ResultadoPrecarga } from './precarga';

const TIPOS_CONTRIBUYENTE = ['ORDINARIO', 'FORMAL', 'ESPECIAL'] as const;
const FORMAS_JURIDICAS = ['PN', 'PJ'] as const;
const RIESGOS = ['minimo', 'medio', 'maximo'] as const;
const NATURALEZAS = ['ACTIVO', 'PASIVO'] as const;

/** Mensaje accionable por motivo de RIF inválido (caso 16: bloqueo con explicación). */
const MENSAJE_RIF: Record<MotivoRifInvalido, string> = {
  formato_invalido: 'El RIF no tiene el formato esperado [VEJPG]-XXXXXXXX-X',
  tipo_invalido: 'El tipo de RIF debe ser V, E, J, P o G',
  digito_verificador: 'El dígito verificador del RIF no concuerda',
};

interface DatosEmpresa {
  rif: string;
  razonSocial: string;
  direccionFiscal: string | null;
  tipoContribuyente: (typeof TIPOS_CONTRIBUYENTE)[number];
  formaJuridica: (typeof FORMAS_JURIDICAS)[number];
  esAgenteRetencionIslr: boolean;
  pctRetencionQueLeAplican: 75 | 100 | null;
  ejercicioFiscalInicio: number;
  riesgoIvss: (typeof RIESGOS)[number] | null;
  diasUtilidades: number | null;
  forzarRif: boolean;
}

function parsePct(valor: unknown): 75 | 100 | null {
  if (valor === undefined || valor === null || String(valor).trim() === '') return null;
  const n = Number(valor);
  if (n !== 75 && n !== 100) throw new BadRequestException('pctRetencionQueLeAplican debe ser 75 o 100');
  return n;
}

function parseDatosEmpresa(body: unknown): DatosEmpresa {
  const b = asRecord(body);
  return {
    rif: requireString(b.rif, 'rif', 20),
    razonSocial: requireString(b.razonSocial, 'razonSocial', 200),
    direccionFiscal: optionalString(b.direccionFiscal, 'direccionFiscal'),
    tipoContribuyente: requireEnum(b.tipoContribuyente, 'tipoContribuyente', TIPOS_CONTRIBUYENTE, (s) => s.toUpperCase()),
    formaJuridica: requireEnum(b.formaJuridica ?? 'PJ', 'formaJuridica', FORMAS_JURIDICAS, (s) => s.toUpperCase()),
    esAgenteRetencionIslr: String(b.esAgenteRetencionIslr ?? '').toLowerCase() === 'true' || b.esAgenteRetencionIslr === true,
    pctRetencionQueLeAplican: parsePct(b.pctRetencionQueLeAplican),
    ejercicioFiscalInicio: optionalInt(b.ejercicioFiscalInicio, 'ejercicioFiscalInicio', 1, 1),
    riesgoIvss:
      b.riesgoIvss === undefined || b.riesgoIvss === null || String(b.riesgoIvss).trim() === ''
        ? null
        : requireEnum(b.riesgoIvss, 'riesgoIvss', RIESGOS, (s) => s.toLowerCase()),
    diasUtilidades:
      b.diasUtilidades === undefined || b.diasUtilidades === null || String(b.diasUtilidades).trim() === ''
        ? null
        : optionalInt(b.diasUtilidades, 'diasUtilidades', 15, 15),
    forzarRif: b.forzarRif === true || String(b.forzarRif ?? '').toLowerCase() === 'true',
  };
}

/** Valida el RIF (caso 16) y devuelve la forma normalizada o lanza, salvo `forzarRif`. */
function resolverRif(rif: string, forzar: boolean): { normalizado: string; valido: boolean } {
  const res = validarRif(rif);
  if (!res.valido && !forzar) {
    throw new BadRequestException({
      message: res.motivo ? MENSAJE_RIF[res.motivo] : 'RIF inválido',
      motivo: res.motivo ?? 'formato_invalido',
      regla: 'caso-16',
    });
  }
  return { normalizado: res.valido ? (res.normalizado as string) : rif.toUpperCase(), valido: res.valido };
}

function perfilDe(datos: DatosEmpresa): PerfilInferido {
  return inferirPerfilTributario({
    tipoContribuyente: datos.tipoContribuyente,
    formaJuridica: datos.formaJuridica,
    esAgenteRetencionIslr: datos.esAgenteRetencionIslr,
    pctRetencionQueLeAplican: datos.pctRetencionQueLeAplican,
    ejercicioFiscalInicio: datos.ejercicioFiscalInicio,
    riesgoIvss: datos.riesgoIvss,
    diasUtilidades: datos.diasUtilidades,
  });
}

export interface ResultadoInferencia {
  readonly rifValido: boolean;
  readonly rifNormalizado: string;
  readonly perfil: PerfilInferido;
}

export interface ResultadoCrearEmpresa {
  readonly companyId: string;
  readonly creada: boolean;
  readonly perfil: PerfilInferido;
  readonly precarga: ResultadoPrecarga;
}

export interface ResultadoApertura {
  readonly aperturaId: string;
  readonly journalEntryId: string;
  readonly creada: boolean;
}

export interface EstadoOnboarding {
  readonly companyId: string;
  readonly empresaCreada: boolean;
  readonly planSembrado: boolean;
  readonly aperturaRegistrada: boolean;
}

/**
 * Asistente de alta de empresa (P30, docs/06 flujo #5, M12). Infiere el perfil tributario (docs/02
 * §1), precarga la configuración (plan de cuentas, plantillas, métodos de pago, series, período) y
 * registra los saldos iniciales como un asiento de apertura balanceado en las 3 bases (regla 7/10;
 * caso 45). Todo bajo `withTenant` (RLS) y auditado en la misma transacción (regla 5). Idempotente.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Paso 1 (preview, sin escritura): valida el RIF e infiere las consecuencias del perfil. */
  inferir(body: unknown): ResultadoInferencia {
    const datos = parseDatosEmpresa(body);
    const { normalizado, valido } = resolverRif(datos.rif, true);
    return { rifValido: valido, rifNormalizado: normalizado, perfil: perfilDe(datos) };
  }

  /** Paso 2: crea la empresa (perfil inferido) y precarga su configuración. Idempotente por RIF. */
  async crearEmpresa(body: unknown): Promise<ResultadoCrearEmpresa> {
    const datos = parseDatosEmpresa(body);
    const { normalizado, valido } = resolverRif(datos.rif, datos.forzarRif);
    const perfil = perfilDe(datos);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();

      const [existente] = await tx
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.rif, normalizado))
        .limit(1);

      let companyId: string;
      let creada: boolean;
      if (existente !== undefined) {
        companyId = existente.id;
        creada = false;
      } else {
        const [fila] = await tx
          .insert(companies)
          .values({
            tenantId: ctx.tenantId,
            rif: normalizado,
            razonSocial: datos.razonSocial,
            direccionFiscal: datos.direccionFiscal,
            tipoContribuyente: datos.tipoContribuyente,
            spe: perfil.esSpe,
            pctRetencionQueLeAplican: perfil.pctRetencionQueLeAplican === null ? null : String(perfil.pctRetencionQueLeAplican),
            ejercicioFiscalInicio: perfil.ejercicioFiscalInicio,
            riesgoIvss: perfil.riesgoIvss,
            diasUtilidades: perfil.diasUtilidades,
          })
          .returning({ id: companies.id });
        if (fila === undefined) throw new Error('No se pudo crear la empresa');
        companyId = fila.id;
        creada = true;
      }

      const precarga = await precargarEmpresa(
        tx,
        { tenantId: ctx.tenantId, userId: ctx.userId ?? null },
        companyId,
        perfil,
      );

      await this.audit.registrar(tx, {
        accion: valido ? 'empresa.crear' : 'empresa.crear.rif_forzado',
        entidad: 'companies',
        entidadId: companyId,
        after: { creada, rif: normalizado, perfil, precarga },
      });

      return { companyId, creada, perfil, precarga };
    });
  }

  /** Paso 3: registra los saldos iniciales como asiento de apertura (3 bases). Idempotente. */
  async registrarSaldosIniciales(body: unknown): Promise<ResultadoApertura> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const fechaAperturaCivil = requireString(b.fechaApertura, 'fechaApertura', 10);
    const capitalVes = requireDecimal(b.capitalVes, 'capitalVes', true);
    const rateUsdMgmt = requireDecimal(b.rateUsdMgmt, 'rateUsdMgmt');
    const renglonesEntrada = parseRenglones(b.renglones);

    const fechaInstante = caracasAUtc(`${fechaAperturaCivil}T12:00:00`);
    const { anio, mes } = periodoFiscal(fechaInstante);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);

      // Idempotencia: una sola apertura por empresa (UNIQUE company_id).
      const [aperturaExistente] = await tx
        .select({ id: companyAperturas.id, journalEntryId: companyAperturas.journalEntryId })
        .from(companyAperturas)
        .where(eq(companyAperturas.companyId, companyId))
        .limit(1);
      if (aperturaExistente !== undefined) {
        return { aperturaId: aperturaExistente.id, journalEntryId: aperturaExistente.journalEntryId, creada: false };
      }

      // Resuelve el almacén por defecto para el inventario sin almacén explícito.
      const almacenDefecto = await almacenPrincipalId(tx, companyId);
      const renglones = renglonesEntrada.map((r) =>
        r.itemId !== undefined && r.warehouseId === undefined && almacenDefecto !== null
          ? { ...r, warehouseId: almacenDefecto }
          : r,
      );

      const { entradaAsiento, movimientosInventario } = construirAsientoApertura({
        fecha: fechaInstante,
        descripcion: 'Asiento de apertura',
        renglones,
        capitalVes,
        rateUsdMgmt,
        companyId,
      });

      // Valida cuadre triple base e imputación a cuentas de movimiento contra el plan de la empresa.
      const plan = await cargarPlan(tx, companyId);
      const asiento = Asiento.construir(entradaAsiento, { plan }).conEstado('POSTED');

      const periodId = await asegurarYRequerirPeriodo(tx, ctx.tenantId, companyId, anio, mes);
      const cuentas = await cargarCuentas(tx, companyId);

      const entryId = await persistirAsiento(tx, asiento, {
        tenantId: ctx.tenantId,
        companyId,
        periodId,
        createdBy: ctx.userId ?? null,
        cuentas: cuentas.porCodigo,
      });

      // Movimientos de inventario de apertura (kardex append-only, doble base; fecha = origen).
      for (const mov of movimientosInventario) {
        const fechaMovInstante = caracasAUtc(`${mov.fechaOrigen}T12:00:00`);
        await tx.insert(stockMoves).values({
          tenantId: ctx.tenantId,
          companyId,
          itemId: mov.itemId,
          warehouseId: mov.warehouseId,
          tipo: 'APERTURA',
          direccion: 'ENTRADA',
          cantidad: mov.cantidad,
          costoUnitVes: mov.costoUnitVes,
          costoUnitUsd: mov.costoUnitUsd,
          valorVes: mov.valorVes,
          valorUsd: mov.valorUsd,
          rateBcv: mov.rateBcv,
          saldoCantidad: mov.cantidad,
          saldoValorVes: mov.valorVes,
          saldoValorUsd: mov.valorUsd,
          costoPromedioVes: mov.costoUnitVes,
          costoPromedioUsd: mov.costoUnitUsd,
          sourceType: 'APERTURA',
          sourceId: entryId,
          journalEntryId: entryId,
          fecha: fechaMovInstante,
          fechaFiscal: fechaFiscal(fechaMovInstante),
          createdBy: ctx.userId ?? null,
        });
      }

      const [apertura] = await tx
        .insert(companyAperturas)
        .values({
          tenantId: ctx.tenantId,
          companyId,
          journalEntryId: entryId,
          fechaApertura: fechaFiscal(fechaInstante),
          createdBy: ctx.userId ?? null,
        })
        .returning({ id: companyAperturas.id });
      if (apertura === undefined) throw new Error('No se pudo registrar la apertura');

      await this.audit.registrar(tx, {
        accion: 'empresa.apertura',
        entidad: 'company_aperturas',
        entidadId: apertura.id,
        after: { companyId, journalEntryId: entryId, inventario: movimientosInventario.length },
      });

      return { aperturaId: apertura.id, journalEntryId: entryId, creada: true };
    });
  }

  /** Estado del asistente para reanudarlo (empresa creada, plan sembrado, apertura registrada). */
  async estado(companyId: string): Promise<EstadoOnboarding> {
    const id = requireUuid(companyId, 'companyId');
    return withTenant(this.database.db, async (tx) => {
      const [empresa] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, id)).limit(1);
      if (empresa === undefined) throw new NotFoundException(`Empresa ${companyId} no encontrada en el tenant actual`);
      const cuentas = await cargarCuentas(tx, id);
      const [apertura] = await tx
        .select({ id: companyAperturas.id })
        .from(companyAperturas)
        .where(eq(companyAperturas.companyId, id))
        .limit(1);
      return {
        companyId: id,
        empresaCreada: true,
        planSembrado: cuentas.porCodigo.size > 0,
        aperturaRegistrada: apertura !== undefined,
      };
    });
  }
}

/** Crea el período si falta y devuelve su id (abierto); lanza si está cerrado (regla 9). */
async function asegurarYRequerirPeriodo(
  tx: DatabaseTx,
  tenantId: string,
  companyId: string,
  anio: number,
  mes: number,
): Promise<string> {
  await asegurarPeriodoAbierto(tx, tenantId, companyId, anio, mes);
  return requerirPeriodoAbierto(tx, companyId, anio, mes);
}

function parseRenglones(valor: unknown): RenglonApertura[] {
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new BadRequestException('Se requiere al menos un saldo inicial (renglones)');
  }
  return valor.map((raw, i) => {
    const r = asRecord(raw);
    const moneda = requireString(r.moneda, `renglones[${i}].moneda`, 8).toUpperCase();
    const esVes = moneda === 'VES';
    const rateBcv = esVes ? null : requireDecimal(r.rateBcv, `renglones[${i}].rateBcv`);
    const itemId = optionalUuid(r.itemId, `renglones[${i}].itemId`);
    const base: RenglonApertura = {
      naturaleza: requireEnum(r.naturaleza, `renglones[${i}].naturaleza`, NATURALEZAS, (s) => s.toUpperCase()),
      cuenta: requireString(r.cuenta, `renglones[${i}].cuenta`, 20),
      moneda,
      montoOrigen: requireDecimal(r.montoOrigen, `renglones[${i}].montoOrigen`),
      rateBcv,
    };
    const partyId = optionalUuid(r.partyId, `renglones[${i}].partyId`);
    const vencimiento = optionalString(r.vencimiento, `renglones[${i}].vencimiento`, 10);
    const warehouseId = optionalUuid(r.warehouseId, `renglones[${i}].warehouseId`);
    const fechaOrigen = optionalString(r.fechaOrigen, `renglones[${i}].fechaOrigen`, 10);
    return {
      ...base,
      ...(partyId !== null ? { partyId } : {}),
      ...(vencimiento !== null ? { vencimiento } : {}),
      ...(itemId !== null ? { itemId } : {}),
      ...(warehouseId !== null ? { warehouseId } : {}),
      ...(r.cantidad !== undefined ? { cantidad: requireDecimal(r.cantidad, `renglones[${i}].cantidad`) } : {}),
      ...(fechaOrigen !== null ? { fechaOrigen } : {}),
    };
  });
}

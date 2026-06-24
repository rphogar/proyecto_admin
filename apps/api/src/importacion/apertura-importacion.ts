import type { RenglonApertura } from '../onboarding/asiento-apertura';
import type { ErrorFila } from './mapeo';
import type { CuentaAbiertaValidada, SaldoValidado } from './mapeo';
import type { FilaCruda } from './parsers/tipos';

/**
 * Construcción PURA de los renglones del asiento de apertura (P31, caso 45) a partir de los saldos
 * iniciales, las CxC y las CxP ya validadas. Resuelve el tercero por RIF y el ítem por SKU contra los
 * maestros (mapas que el servicio arma tras importar terceros/ítems primero). Las filas que referencian
 * un RIF/SKU inexistente se reportan como error (no se inventan maestros); el resto se vuelve renglón en
 * la forma que consume `OnboardingService.registrarSaldosIniciales` (reúso total del motor P30).
 */

/** Cuenta de CxC en Bs y en divisas (plan base docs/03 §2). */
const CXC_VES = '1.2.01';
const CXC_DIVISA = '1.2.02';
/** Cuenta de proveedores (CxP), Bs y divisas (plan base). */
const CXP = '2.1';

export interface MapasResolucion {
  /** RIF normalizado → party_id. */
  readonly partyPorRif: ReadonlyMap<string, string>;
  /** SKU → item_id. */
  readonly itemPorSku: ReadonlyMap<string, string>;
  /** Almacén por defecto del inventario de apertura (cuando el saldo no trae uno explícito). */
  readonly warehousePrincipalId?: string | null;
}

export interface RenglonesApertura {
  readonly renglones: RenglonApertura[];
  readonly errores: ErrorFila[];
}

function aRateBcv(moneda: string, rateBcv: string | null): string | null {
  return moneda.toUpperCase() === 'VES' ? null : rateBcv;
}

/**
 * Arma los renglones de apertura. `cuentaAbiertaA` decide la cuenta por defecto según la naturaleza
 * (CxC = activo, CxP = pasivo) y la moneda.
 */
export function construirRenglonesApertura(
  saldos: ReadonlyArray<FilaCruda<SaldoValidado>>,
  cxc: ReadonlyArray<FilaCruda<CuentaAbiertaValidada>>,
  cxp: ReadonlyArray<FilaCruda<CuentaAbiertaValidada>>,
  mapas: MapasResolucion,
): RenglonesApertura {
  const renglones: RenglonApertura[] = [];
  const errores: ErrorFila[] = [];

  // Saldos (caja, bancos, inventario, otros): cuenta explícita; el inventario resuelve el ítem por SKU.
  for (const { fila, datos: s } of saldos) {
    if (s.sku !== null) {
      const itemId = mapas.itemPorSku.get(s.sku);
      if (itemId === undefined) {
        errores.push({ fila, campo: 'sku', mensaje: `SKU "${s.sku}" no existe (importe los ítems primero)` });
        continue;
      }
      if (s.fechaOrigen === null) {
        errores.push({ fila, campo: 'fechaOrigen', mensaje: 'el inventario requiere fecha de origen (caso 45)' });
        continue;
      }
      renglones.push({
        naturaleza: s.naturaleza,
        cuenta: s.cuenta,
        moneda: s.moneda,
        montoOrigen: s.monto,
        rateBcv: aRateBcv(s.moneda, s.rateBcv),
        itemId,
        ...(mapas.warehousePrincipalId != null ? { warehouseId: mapas.warehousePrincipalId } : {}),
        cantidad: s.cantidad as string,
        fechaOrigen: s.fechaOrigen,
      });
      continue;
    }
    renglones.push({
      naturaleza: s.naturaleza,
      cuenta: s.cuenta,
      moneda: s.moneda,
      montoOrigen: s.monto,
      rateBcv: aRateBcv(s.moneda, s.rateBcv),
    });
  }

  // CxC abiertas → activo por tercero. CxP abiertas → pasivo por tercero.
  agregarCuentasAbiertas(cxc, 'ACTIVO', mapas, renglones, errores);
  agregarCuentasAbiertas(cxp, 'PASIVO', mapas, renglones, errores);

  return { renglones, errores };
}

function cuentaPorDefecto(naturaleza: 'ACTIVO' | 'PASIVO', moneda: string): string {
  if (naturaleza === 'PASIVO') return CXP;
  return moneda.toUpperCase() === 'VES' ? CXC_VES : CXC_DIVISA;
}

function agregarCuentasAbiertas(
  filas: ReadonlyArray<FilaCruda<CuentaAbiertaValidada>>,
  naturaleza: 'ACTIVO' | 'PASIVO',
  mapas: MapasResolucion,
  renglones: RenglonApertura[],
  errores: ErrorFila[],
): void {
  for (const { fila, datos: c } of filas) {
    const partyId = mapas.partyPorRif.get(c.rif);
    if (partyId === undefined) {
      errores.push({ fila, campo: 'rif', mensaje: `RIF "${c.rif}" no existe (importe los terceros primero)` });
      continue;
    }
    renglones.push({
      naturaleza,
      cuenta: c.cuenta ?? cuentaPorDefecto(naturaleza, c.moneda),
      moneda: c.moneda,
      montoOrigen: c.monto,
      rateBcv: aRateBcv(c.moneda, c.rateBcv),
      partyId,
      ...(c.vencimiento !== null ? { vencimiento: c.vencimiento } : {}),
    });
  }
}

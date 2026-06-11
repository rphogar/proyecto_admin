import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import type { DatabaseTx } from '../db/database.service';
import { accounts, paymentMethods } from '../db/schema';
import { CrudMaestroService } from './crud-maestro';
import {
  asRecord,
  optionalBoolean,
  requireEnum,
  requireString,
  requireUuid,
} from './validacion';

const CODIGOS = [
  'EFECTIVO_BS',
  'EFECTIVO_USD',
  'PAGO_MOVIL',
  'TRANSFERENCIA',
  'PUNTO_VENTA',
  'ZELLE',
  'USDT',
  'OTRO',
] as const;
const MONEDAS = ['VES', 'USD', 'EUR'] as const;

type FilaPaymentMethod = typeof paymentMethods.$inferSelect;

interface ValoresPaymentMethod {
  codigo: (typeof CODIGOS)[number];
  nombre: string;
  moneda: (typeof MONEDAS)[number];
  cuentaId: string;
  causaIgtf: boolean;
  activo: boolean;
}

function parseCrear(body: unknown): { companyId: string; valores: ValoresPaymentMethod } {
  const b = asRecord(body);
  return {
    companyId: requireUuid(b.companyId, 'companyId'),
    valores: {
      codigo: requireEnum(b.codigo, 'codigo', CODIGOS, (s) => s.toUpperCase()),
      nombre: requireString(b.nombre, 'nombre'),
      moneda: requireEnum(b.moneda ?? 'VES', 'moneda', MONEDAS, (s) => s.toUpperCase()),
      cuentaId: requireUuid(b.cuentaId, 'cuentaId'),
      causaIgtf: optionalBoolean(b.causaIgtf, false),
      activo: optionalBoolean(b.activo, true),
    },
  };
}

function parseActualizar(body: unknown): Partial<ValoresPaymentMethod> {
  const b = asRecord(body);
  const out: Partial<ValoresPaymentMethod> = {};
  if ('nombre' in b) out.nombre = requireString(b.nombre, 'nombre');
  if ('moneda' in b) out.moneda = requireEnum(b.moneda, 'moneda', MONEDAS, (s) => s.toUpperCase());
  if ('cuentaId' in b) out.cuentaId = requireUuid(b.cuentaId, 'cuentaId');
  if ('causaIgtf' in b) out.causaIgtf = optionalBoolean(b.causaIgtf, false);
  if ('activo' in b) out.activo = optionalBoolean(b.activo, true);
  return out;
}

/**
 * Verifica que la cuenta contable sea de la misma empresa y de MOVIMIENTO (hoja): un método de pago
 * no puede asentar contra una cuenta totalizadora (docs/03 §2, igual criterio que el ledger).
 */
async function validarReferencias(
  tx: DatabaseTx,
  companyId: string,
  valores: Partial<ValoresPaymentMethod>,
): Promise<void> {
  if (valores.cuentaId === undefined) {
    return;
  }
  const [cuenta] = await tx
    .select({ id: accounts.id, esMovimiento: accounts.esMovimiento })
    .from(accounts)
    .where(and(eq(accounts.id, valores.cuentaId), eq(accounts.companyId, companyId)))
    .limit(1);
  if (cuenta === undefined) {
    throw new NotFoundException(`Cuenta ${valores.cuentaId} no encontrada en la empresa`);
  }
  if (!cuenta.esMovimiento) {
    throw new BadRequestException('La cuenta del método de pago debe ser de movimiento (hoja)');
  }
}

/** Maestro de métodos de pago mapeados a cuenta contable y a si causan IGTF (docs/05 §3.6). */
@Injectable()
export class PaymentMethodsService extends CrudMaestroService<FilaPaymentMethod, ValoresPaymentMethod> {
  constructor(database: DatabaseService, audit: AuditService) {
    super(database, audit, {
      tabla: paymentMethods,
      entidad: 'payment_methods',
      accion: 'payment_method',
      idCol: paymentMethods.id,
      companyCol: paymentMethods.companyId,
      ordenCol: paymentMethods.codigo,
      parseCrear,
      parseActualizar,
      validarReferencias,
    });
  }
}

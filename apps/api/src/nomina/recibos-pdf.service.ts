import { createElement as h } from 'react';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { companies, nominaCorridas, nominaReciboLineas, nominaRecibos, nominaTrabajadores } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { requireUuid } from '../maestros/validacion';
import { withTenant } from '../tenant/with-tenant';

/**
 * Recibo de pago en PDF server-side (P15, docs/04 §5). Muestra el desglose de asignaciones y
 * deducciones, el neto en Bs y —si aplica— el equivalente en USD. Usa `@react-pdf/renderer` vía
 * `createElement` (sin JSX), igual que la factura.
 */
@Injectable()
export class RecibosPdfService {
  constructor(private readonly database: DatabaseService) {}

  async generar(companyId: string, reciboId: string): Promise<{ buffer: Buffer; filename: string }> {
    const cid = requireUuid(companyId, 'companyId');
    const rid = requireUuid(reciboId, 'reciboId');
    const datos = await withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, cid);
      const [recibo] = await tx.select().from(nominaRecibos).where(and(eq(nominaRecibos.id, rid), eq(nominaRecibos.companyId, cid))).limit(1);
      if (recibo === undefined) throw new BadRequestException(`El recibo ${rid} no existe en la empresa`);
      const lineas = await tx.select().from(nominaReciboLineas).where(eq(nominaReciboLineas.reciboId, rid)).orderBy(nominaReciboLineas.orden);
      const [trabajador] = await tx.select().from(nominaTrabajadores).where(eq(nominaTrabajadores.id, recibo.trabajadorId)).limit(1);
      const [corrida] = await tx.select().from(nominaCorridas).where(eq(nominaCorridas.id, recibo.corridaId)).limit(1);
      const [company] = await tx.select().from(companies).where(eq(companies.id, cid)).limit(1);
      return { recibo, lineas, trabajador, corrida, company };
    });

    const buffer = await renderToBuffer(documento(datos));
    return { buffer, filename: `recibo-${datos.corrida?.periodoEtiqueta ?? 'nomina'}-${datos.trabajador?.cedula ?? rid}.pdf` };
  }
}

const S = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  empresa: { fontSize: 13, fontWeight: 'bold' },
  titulo: { fontSize: 12, fontWeight: 'bold', marginTop: 8, marginBottom: 8 },
  fila: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#ddd', paddingVertical: 3 },
  cab: { flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 4, fontWeight: 'bold' },
  cDesc: { flex: 4 },
  cNum: { flex: 1, textAlign: 'right' },
  totRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 1 },
  totLabel: { width: 160, textAlign: 'right', marginRight: 8 },
  totVal: { width: 100, textAlign: 'right' },
  seccion: { marginTop: 10 },
});

function fmt(n: string | null): string {
  return Number(n ?? '0').toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface DatosRecibo {
  recibo: typeof nominaRecibos.$inferSelect;
  lineas: (typeof nominaReciboLineas.$inferSelect)[];
  trabajador: typeof nominaTrabajadores.$inferSelect | undefined;
  corrida: typeof nominaCorridas.$inferSelect | undefined;
  company: typeof companies.$inferSelect | undefined;
}

function documento(d: DatosRecibo) {
  const asignaciones = d.lineas.filter((l) => l.tipo === 'ASIGNACION');
  const deducciones = d.lineas.filter((l) => l.tipo === 'DEDUCCION');
  const filaLinea = (l: (typeof nominaReciboLineas.$inferSelect)) =>
    h(View, { key: l.id, style: S.fila }, [
      h(Text, { key: 'd', style: S.cDesc }, l.nombre),
      h(Text, { key: 'v', style: S.cNum }, `Bs ${fmt(l.montoVes)}`),
    ]);

  return h(Document, {}, h(Page, { size: 'A4', style: S.page }, [
    h(Text, { key: 'rs', style: S.empresa }, d.company?.razonSocial ?? ''),
    h(Text, { key: 'rif' }, `RIF: ${d.company?.rif ?? ''}`),
    h(Text, { key: 't', style: S.titulo }, `RECIBO DE PAGO — ${d.corrida?.periodoEtiqueta ?? ''}`),
    h(View, { key: 'trab', style: S.seccion }, [
      h(Text, { key: 'n' }, `Trabajador: ${d.trabajador?.nombre ?? ''}    C.I./RIF: ${d.trabajador?.cedula ?? ''}`),
      h(Text, { key: 'd' }, `Cargo: ${d.trabajador?.cargo ?? '—'}    Días: ${fmt(d.recibo.diasEfectivos)}`),
    ]),
    h(Text, { key: 'ca', style: S.titulo }, 'Asignaciones'),
    h(View, { key: 'cab-a', style: S.cab }, [h(Text, { key: 'd', style: S.cDesc }, 'Concepto'), h(Text, { key: 'v', style: S.cNum }, 'Monto')]),
    h(View, { key: 'la' }, asignaciones.map(filaLinea)),
    h(Text, { key: 'cd', style: S.titulo }, 'Deducciones'),
    h(View, { key: 'cab-d', style: S.cab }, [h(Text, { key: 'd', style: S.cDesc }, 'Concepto'), h(Text, { key: 'v', style: S.cNum }, 'Monto')]),
    h(View, { key: 'ld' }, deducciones.map(filaLinea)),
    h(View, { key: 'tot', style: S.seccion }, [
      h(View, { key: 'a', style: S.totRow }, [h(Text, { key: 'l', style: S.totLabel }, 'Total asignaciones'), h(Text, { key: 'v', style: S.totVal }, `Bs ${fmt(d.recibo.totalAsignaciones)}`)]),
      h(View, { key: 'd', style: S.totRow }, [h(Text, { key: 'l', style: S.totLabel }, 'Total deducciones'), h(Text, { key: 'v', style: S.totVal }, `Bs ${fmt(d.recibo.totalDeducciones)}`)]),
      h(View, { key: 'n', style: S.totRow }, [h(Text, { key: 'l', style: { ...S.totLabel, fontWeight: 'bold' } }, 'NETO A PAGAR'), h(Text, { key: 'v', style: { ...S.totVal, fontWeight: 'bold' } }, `Bs ${fmt(d.recibo.neto)}`)]),
      d.recibo.netoUsd != null
        ? h(View, { key: 'u', style: S.totRow }, [h(Text, { key: 'l', style: S.totLabel }, 'Equivalente USD'), h(Text, { key: 'v', style: S.totVal }, `$ ${fmt(d.recibo.netoUsd)}`)])
        : null,
    ]),
  ]));
}

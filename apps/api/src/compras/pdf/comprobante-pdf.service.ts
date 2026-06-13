import { createElement as h } from 'react';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service';
import { companies, purchases, retentionsIssued } from '../../db/schema';
import { asegurarEmpresaDelTenant } from '../../maestros/companias';
import { withTenant } from '../../tenant/with-tenant';

/**
 * Generación server-side del PDF del **comprobante de retención** (IVA/ISLR) que la empresa entrega
 * al proveedor (Providencia SNAT/2015/0049 para IVA; docs/02 §3.3/§4). Incluye los datos del agente
 * y del retenido, el número de comprobante normado (`AAAAMMNNNNNNNN`), el período de imputación, la
 * factura afectada, la base, el porcentaje/tarifa (y el sustraendo en ISLR) y el monto retenido.
 *
 * Usa `@react-pdf/renderer` vía `React.createElement` (sin JSX), igual que la factura.
 */
@Injectable()
export class RetencionComprobantePdfService {
  constructor(private readonly database: DatabaseService) {}

  async generar(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const { comprobante, compra, company } = await withTenant(this.database.db, async (tx) => {
      const [c] = await tx.select().from(retentionsIssued).where(eq(retentionsIssued.id, id)).limit(1);
      if (c === undefined) throw new NotFoundException(`Comprobante ${id} no encontrado`);
      await asegurarEmpresaDelTenant(tx, c.companyId);
      const [p] = await tx.select().from(purchases).where(eq(purchases.id, c.purchaseId)).limit(1);
      const [emp] = await tx.select().from(companies).where(eq(companies.id, c.companyId)).limit(1);
      return { comprobante: c, compra: p, company: emp };
    });

    const buffer = await renderToBuffer(documento(comprobante, compra, company));
    return { buffer, filename: `RET-${comprobante.tipo}-${comprobante.numeroComprobante}.pdf` };
  }
}

const S = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  empresa: { fontSize: 13, fontWeight: 'bold' },
  caja: { borderWidth: 1, borderColor: '#1e3a8a', borderRadius: 4, padding: 6, minWidth: 200 },
  tipo: { fontSize: 12, fontWeight: 'bold', color: '#1e3a8a' },
  seccion: { marginTop: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  label: { width: 200 },
  val: { flex: 1, textAlign: 'right' },
  pie: { position: 'absolute', bottom: 24, left: 32, right: 32, fontSize: 7, color: '#666', textAlign: 'center' },
});

function fmt(n: string | null): string {
  return Number(n ?? '0').toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function documento(
  c: typeof retentionsIssued.$inferSelect,
  compra: typeof purchases.$inferSelect | undefined,
  company: typeof companies.$inferSelect | undefined,
) {
  const denom = c.tipo === 'IVA' ? 'COMPROBANTE DE RETENCIÓN DE IVA' : 'COMPROBANTE DE RETENCIÓN DE ISLR';
  const periodo = `${c.periodoAnio}-${String(c.periodoMes).padStart(2, '0')}`;
  const filaVal = (key: string, label: string, valor: string) =>
    h(View, { key, style: S.row }, [h(Text, { key: 'l', style: S.label }, label), h(Text, { key: 'v', style: S.val }, valor)]);

  return h(Document, {}, h(Page, { size: 'A4', style: S.page }, [
    h(View, { key: 'head', style: S.header }, [
      h(View, { key: 'em', style: { maxWidth: 300 } }, [
        h(Text, { key: 'rs', style: S.empresa }, company?.razonSocial ?? ''),
        h(Text, { key: 'rif' }, `Agente de retención — RIF: ${company?.rif ?? ''}`),
        h(Text, { key: 'dom' }, company?.direccionFiscal ?? ''),
      ]),
      h(View, { key: 'cj', style: S.caja }, [
        h(Text, { key: 't', style: S.tipo }, denom),
        h(Text, { key: 'n' }, `Comprobante Nº ${c.numeroComprobante}`),
        h(Text, { key: 'p' }, `Período: ${periodo}`),
        h(Text, { key: 'f' }, `Fecha: ${c.fechaFiscal}`),
      ]),
    ]),
    h(View, { key: 'ret', style: S.seccion }, [
      h(Text, { key: 'tt', style: { fontWeight: 'bold', marginBottom: 4 } }, 'Sujeto retenido'),
      h(Text, { key: 'n' }, `${c.proveedorNombre}`),
      h(Text, { key: 'r' }, `RIF: ${c.proveedorRif}`),
    ]),
    h(View, { key: 'doc', style: S.seccion }, [
      h(Text, { key: 'tt', style: { fontWeight: 'bold', marginBottom: 4 } }, 'Documento afectado'),
      filaVal('nd', 'Factura del proveedor', `${compra?.tipoDocumento ?? ''} ${compra?.numeroDocumento ?? ''}`),
      filaVal('nc', 'Número de control', compra?.numeroControl ?? '—'),
    ]),
    h(View, { key: 'mont', style: S.seccion }, [
      h(Text, { key: 'tt', style: { fontWeight: 'bold', marginBottom: 4 } }, 'Retención'),
      c.conceptoIslr ? filaVal('cn', 'Concepto', c.conceptoIslr) : null,
      filaVal('b', c.tipo === 'IVA' ? 'IVA de la factura (Bs)' : 'Base de retención (Bs)', fmt(c.baseVes)),
      filaVal('p', c.tipo === 'IVA' ? 'Porcentaje retenido' : 'Tarifa', `${fmt(c.porcentaje)}%`),
      Number(c.sustraendoVes ?? '0') > 0 ? filaVal('s', 'Sustraendo (Bs)', fmt(c.sustraendoVes)) : null,
      h(View, { key: 'm', style: { ...S.row, marginTop: 4 } }, [
        h(Text, { key: 'l', style: { ...S.label, fontWeight: 'bold' } }, 'MONTO RETENIDO (Bs)'),
        h(Text, { key: 'v', style: { ...S.val, fontWeight: 'bold' } }, fmt(c.montoVes)),
      ]),
    ]),
    h(Text, { key: 'pie', style: S.pie, fixed: true }, 'Comprobante de retención generado por ContaVE. Conserve este documento (COT: 10 años).'),
  ]));
}

import { createElement as h } from 'react';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../../db/database.service';
import { companies, fiscalParams } from '../../db/schema';
import { withTenant } from '../../tenant/with-tenant';
import { type DocumentoConDetalle, DocumentosService } from '../documentos.service';

/** Configuración (mínima) de la plantilla de factura — editable luego en M12. */
interface PlantillaFactura {
  readonly color: string;
  readonly pie: string;
}
const PLANTILLA_DEFECTO: PlantillaFactura = {
  color: '#1e3a8a',
  pie: 'Documento generado por ContaVE. Conserve esta factura (COT: 10 años).',
};

const NOMBRE_TIPO: Record<string, string> = {
  FACTURA: 'FACTURA',
  NOTA_CREDITO: 'NOTA DE CRÉDITO',
  NOTA_DEBITO: 'NOTA DE DÉBITO',
};

/**
 * Generación server-side del PDF de la factura (CLAUDE.md: PDF server-side; doc 06 M1). Cumple los
 * requisitos de la Providencia SNAT/2011/00071: datos del emisor, denominación, número y número de
 * control, adquirente, líneas, base e IVA discriminados por alícuota, total y condición de pago;
 * y —si el documento está en divisas— el **equivalente en bolívares y la tasa BCV aplicada**.
 *
 * Usa `@react-pdf/renderer` vía `React.createElement` (sin JSX) para no alterar la configuración de
 * build de Nest. La plantilla es configurable (`fiscal_params` clave `plantilla_factura`).
 */
@Injectable()
export class FacturaPdfService {
  constructor(
    private readonly database: DatabaseService,
    private readonly documentos: DocumentosService,
  ) {}

  async generar(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const detalle = await this.documentos.obtener(id);
    const { company, plantilla } = await withTenant(this.database.db, async (tx) => {
      const [c] = await tx.select().from(companies).where(eq(companies.id, detalle.documento.companyId)).limit(1);
      const [p] = await tx
        .select({ valor: fiscalParams.valor })
        .from(fiscalParams)
        .where(and(eq(fiscalParams.clave, 'plantilla_factura'), isNull(fiscalParams.vigenteHasta)))
        .limit(1);
      return { company: c, plantilla: { ...PLANTILLA_DEFECTO, ...((p?.valor as Partial<PlantillaFactura>) ?? {}) } };
    });

    const buffer = await renderToBuffer(documento(detalle, company, plantilla));
    const numero = detalle.documento.number ?? 'BORRADOR';
    return { buffer, filename: `${detalle.documento.type}-${numero}.pdf` };
  }
}

const S = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  emisor: { maxWidth: 320 },
  empresa: { fontSize: 13, fontWeight: 'bold' },
  caja: { borderWidth: 1, borderColor: '#999', borderRadius: 4, padding: 6, minWidth: 160 },
  tipo: { fontSize: 12, fontWeight: 'bold' },
  fila: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#ddd', paddingVertical: 3 },
  cab: { flexDirection: 'row', borderBottomWidth: 1, paddingVertical: 4, fontWeight: 'bold' },
  cDesc: { flex: 4 },
  cNum: { flex: 1, textAlign: 'right' },
  seccion: { marginTop: 10 },
  totRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 1 },
  totLabel: { width: 140, textAlign: 'right', marginRight: 8 },
  totVal: { width: 90, textAlign: 'right' },
  pie: { position: 'absolute', bottom: 24, left: 32, right: 32, fontSize: 7, color: '#666', textAlign: 'center' },
});

function fmt(n: string | null): string {
  const v = Number(n ?? '0');
  return v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function documento(
  detalle: DocumentoConDetalle,
  company: typeof companies.$inferSelect | undefined,
  plantilla: PlantillaFactura,
) {
  const d = detalle.documento;
  const esDivisa = d.currency !== 'VES';
  const denom = NOMBRE_TIPO[d.type] ?? d.type;

  const filasLineas = detalle.lineas.map((l) =>
    h(View, { key: l.id, style: S.fila }, [
      h(Text, { key: 'd', style: S.cDesc }, l.descripcion),
      h(Text, { key: 'c', style: S.cNum }, fmt(l.cantidad)),
      h(Text, { key: 'p', style: S.cNum }, fmt(l.precioUnitarioOrigen)),
      h(Text, { key: 'a', style: S.cNum }, `${fmt(l.alicuotaTasa)}%`),
      h(Text, { key: 'b', style: S.cNum }, fmt(l.baseOrigen)),
    ]),
  );

  const filasImpuestos = detalle.impuestos.map((t) =>
    h(View, { key: t.id, style: S.totRow }, [
      h(Text, { key: 'l', style: S.totLabel }, `Base ${t.alicuotaCodigo} (${fmt(t.alicuotaTasa)}%)`),
      h(Text, { key: 'v', style: S.totVal }, fmt(t.baseOrigen)),
    ]),
  );
  const filasIva = detalle.impuestos
    .filter((t) => Number(t.montoOrigen) > 0)
    .map((t) =>
      h(View, { key: `iva-${t.id}`, style: S.totRow }, [
        h(Text, { key: 'l', style: S.totLabel }, `IVA ${fmt(t.alicuotaTasa)}%`),
        h(Text, { key: 'v', style: S.totVal }, fmt(t.montoOrigen)),
      ]),
    );

  return h(Document, {}, h(Page, { size: 'A4', style: S.page }, [
    // Cabecera: emisor + caja de denominación/número/control.
    h(View, { key: 'head', style: S.header }, [
      h(View, { key: 'em', style: S.emisor }, [
        h(Text, { key: 'rs', style: S.empresa }, company?.razonSocial ?? ''),
        h(Text, { key: 'rif' }, `RIF: ${company?.rif ?? ''}`),
        h(Text, { key: 'dom' }, company?.direccionFiscal ?? ''),
      ]),
      h(View, { key: 'cj', style: { ...S.caja, borderColor: plantilla.color } }, [
        h(Text, { key: 't', style: { ...S.tipo, color: plantilla.color } }, denom),
        h(Text, { key: 'n' }, `Nº ${d.number ?? 'BORRADOR'}`),
        h(Text, { key: 'ctl' }, `Control: ${d.controlNumber ?? '—'}`),
        h(Text, { key: 'f' }, `Fecha: ${d.issueFechaFiscal}`),
      ]),
    ]),
    // Adquirente.
    h(View, { key: 'adq', style: S.seccion }, [
      h(Text, { key: 'n' }, `Cliente: ${d.partyNombre ?? 'Consumidor final'}`),
      h(Text, { key: 'r' }, `RIF/CI: ${d.partyRif ?? '—'}    Condición: ${d.paymentCondition ?? '—'}`),
    ]),
    // Líneas.
    h(View, { key: 'cab', style: S.cab }, [
      h(Text, { key: 'd', style: S.cDesc }, 'Descripción'),
      h(Text, { key: 'c', style: S.cNum }, 'Cant.'),
      h(Text, { key: 'p', style: S.cNum }, `P.Unit (${d.currency})`),
      h(Text, { key: 'a', style: S.cNum }, 'Alíc.'),
      h(Text, { key: 'b', style: S.cNum }, 'Base'),
    ]),
    h(View, { key: 'lineas' }, filasLineas),
    // Totales por alícuota + IVA + total.
    h(View, { key: 'tot', style: S.seccion }, [
      ...filasImpuestos,
      ...filasIva,
      h(View, { key: 'total', style: S.totRow }, [
        h(Text, { key: 'l', style: { ...S.totLabel, fontWeight: 'bold' } }, `TOTAL (${d.currency})`),
        h(Text, { key: 'v', style: { ...S.totVal, fontWeight: 'bold' } }, fmt(d.totalOrigen)),
      ]),
      // Requisito 00071 para divisas: equivalente en Bs + tasa BCV aplicada.
      esDivisa
        ? h(View, { key: 'bs', style: { ...S.seccion } }, [
            h(View, { key: 'r1', style: S.totRow }, [
              h(Text, { key: 'l', style: S.totLabel }, 'Tasa BCV aplicada'),
              h(Text, { key: 'v', style: S.totVal }, `Bs ${fmt(d.rateBcv)}`),
            ]),
            h(View, { key: 'r2', style: S.totRow }, [
              h(Text, { key: 'l', style: { ...S.totLabel, fontWeight: 'bold' } }, 'Equivalente en Bs'),
              h(Text, { key: 'v', style: { ...S.totVal, fontWeight: 'bold' } }, fmt(d.totalVes)),
            ]),
          ])
        : null,
    ]),
    h(Text, { key: 'pie', style: S.pie, fixed: true }, plantilla.pie),
  ]));
}

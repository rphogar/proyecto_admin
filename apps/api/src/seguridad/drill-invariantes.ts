import postgres, { type Sql } from 'postgres';
import {
  type DatosInvariantes,
  type ReporteInvariantes,
  verificarInvariantes,
} from './verificacion-invariantes';

/**
 * Drill de backup/restore automatizado (docs/05 §6: "restore drill mensual"; caso 56). Extrae de
 * la base — idealmente una **restaurada en ambiente limpio** — las filas necesarias y corre la
 * verificación de invariantes (§7). Devuelve el reporte; el CLI sale con código ≠ 0 si hay
 * violaciones, para que el job mensual falle ruidosamente.
 *
 * Lee con una conexión owner (sin RLS) porque el drill audita TODO el backup, no un tenant.
 */
export async function extraerDatosInvariantes(sql: Sql): Promise<DatosInvariantes> {
  const lineas = await sql<
    {
      entry_id: string;
      dc: string;
      currency: string;
      amount_ves: string;
      amount_usd_mgmt: string;
      amount_origin: string;
    }[]
  >`
    SELECT jl.entry_id, jl.dc, jl.currency, jl.amount_ves, jl.amount_usd_mgmt, jl.amount_origin
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    WHERE je.estado = 'POSTED'
  `;

  const documentos = await sql<{ series_id: string; number: number }[]>`
    SELECT series_id, number FROM documents
    WHERE status IN ('ISSUED', 'APPLIED') AND number IS NOT NULL
  `;

  return {
    lineasAsientos: lineas.map((l) => ({
      entryId: l.entry_id,
      dc: l.dc,
      currency: l.currency,
      amountVes: l.amount_ves,
      amountUsdMgmt: l.amount_usd_mgmt,
      amountOrigen: l.amount_origin,
    })),
    documentos: documentos.map((d) => ({ seriesId: d.series_id, number: Number(d.number) })),
  };
}

/** Extrae y verifica en un solo paso. */
export async function ejecutarDrill(sql: Sql): Promise<ReporteInvariantes> {
  return verificarInvariantes(await extraerDatosInvariantes(sql));
}

/** Formatea el reporte para el log del job. */
export function formatearReporte(r: ReporteInvariantes): string {
  const cabecera = `Drill de invariantes: ${r.ok ? 'OK' : 'FALLÓ'} — ${r.asientosVerificados} asientos, ${r.seriesVerificadas} series`;
  if (r.ok) {
    return cabecera;
  }
  return [cabecera, ...r.violaciones.map((v) => `  ✗ [${v.invariante}] ${v.detalle}`)].join('\n');
}

// Entrada CLI: `tsx src/seguridad/drill-invariantes.ts` contra DATABASE_URL (ambiente restaurado).
const isCli = process.argv[1]?.includes('drill-invariantes');
if (isCli) {
  const url = process.env.DATABASE_URL ?? 'postgresql://contave:contave_dev@localhost:5432/contave';
  const sql = postgres(url, { max: 1 });
  ejecutarDrill(sql)
    .then((reporte) => {
      console.log(formatearReporte(reporte));
      process.exitCode = reporte.ok ? 0 : 1;
    })
    .catch((err: unknown) => {
      console.error('Drill de invariantes abortado:', err);
      process.exitCode = 2;
    })
    .finally(() => {
      void sql.end();
    });
}

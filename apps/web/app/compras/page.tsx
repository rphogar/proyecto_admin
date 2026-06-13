'use client';

import { useQuery } from '@tanstack/react-query';
import { comprasApi } from '@/lib/compras-api';
import { useEmpresaActiva } from '@/lib/empresa-activa';

/** Listado de facturas de compra registradas de la empresa (doc 06 M2). */
export default function ComprasPage() {
  const { companyId } = useEmpresaActiva();
  const lista = useQuery({
    queryKey: ['compras', companyId],
    queryFn: () => comprasApi.listar(companyId as string),
    enabled: companyId !== null,
  });

  if (companyId === null) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Selecciona una empresa en la barra superior.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Facturas de compra</h1>
        <p className="text-sm text-muted-foreground">
          Compras registradas con crédito fiscal y retenciones de IVA/ISLR como agente.
        </p>
      </header>
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Fecha</th>
              <th className="px-3 py-2 font-medium">Proveedor</th>
              <th className="px-3 py-2 font-medium">Documento</th>
              <th className="px-3 py-2 font-medium">Total Bs</th>
              <th className="px-3 py-2 font-medium">Ret. IVA</th>
              <th className="px-3 py-2 font-medium">Ret. ISLR</th>
              <th className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {lista.isLoading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Cargando…</td></tr>
            )}
            {lista.data?.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sin compras todavía.</td></tr>
            )}
            {lista.data?.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-3 py-2">{c.fechaFiscal}</td>
                <td className="px-3 py-2">{c.proveedorNombre}</td>
                <td className="px-3 py-2">{c.tipoDocumento} {c.numeroDocumento}</td>
                <td className="px-3 py-2">{c.totalVes}</td>
                <td className="px-3 py-2">{c.retencionIvaVes ?? '—'}</td>
                <td className="px-3 py-2">{c.retencionIslrVes ?? '—'}</td>
                <td className="px-3 py-2 text-emerald-700">{c.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

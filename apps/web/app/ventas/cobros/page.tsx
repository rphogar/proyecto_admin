'use client';

import { useQuery } from '@tanstack/react-query';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { cobrosApi } from '@/lib/ventas-api';

interface CobroFila {
  id: string;
  fechaFiscal: string;
  totalVes: string | null;
  igtfTotalVes: string | null;
  status: string;
}

/** Listado de cobros registrados de la empresa (doc 06 M3). */
export default function CobrosPage() {
  const { companyId } = useEmpresaActiva();
  const lista = useQuery({
    queryKey: ['cobros', companyId],
    queryFn: () => cobrosApi.listar(companyId as string) as Promise<CobroFila[]>,
    enabled: companyId !== null,
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Cobros</h1>
        <p className="text-sm text-muted-foreground">Cobros registrados (con IGTF y diferencial cambiario automáticos).</p>
      </header>
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Fecha</th>
              <th className="px-3 py-2 font-medium">Total Bs</th>
              <th className="px-3 py-2 font-medium">IGTF Bs</th>
              <th className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {lista.isLoading && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Cargando…</td></tr>}
            {lista.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Sin cobros todavía.</td></tr>}
            {lista.data?.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-3 py-2">{c.fechaFiscal}</td>
                <td className="px-3 py-2">{c.totalVes}</td>
                <td className="px-3 py-2">{c.igtfTotalVes ?? '—'}</td>
                <td className="px-3 py-2 text-emerald-700">{c.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

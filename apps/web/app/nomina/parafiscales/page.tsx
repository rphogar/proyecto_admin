'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { nominaApi } from '@/lib/nomina-api';

const HOY = new Date();

/** Parafiscales (doc 04 §3): liquidación por régimen y descarga de planillas TIUNA/FAOV/INCES. */
export default function ParafiscalesPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [periodo, setPeriodo] = useState({ anio: HOY.getFullYear(), mes: HOY.getMonth() + 1 });
  const [error, setError] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['nomina', 'parafiscales', companyId, periodo.anio, periodo.mes],
    queryFn: () => nominaApi.listarParafiscales(companyId as string, periodo.anio, periodo.mes),
    enabled: companyId !== null,
  });

  const calcular = useMutation({
    mutationFn: () => nominaApi.calcularParafiscales({ companyId, anio: periodo.anio, mes: periodo.mes }),
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['nomina', 'parafiscales', companyId, periodo.anio, periodo.mes] }); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error'),
  });

  const descargar = useMutation({
    mutationFn: (regimen: string) => nominaApi.descargarPlanilla({ companyId: companyId as string, anio: periodo.anio, mes: periodo.mes, regimen }),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error'),
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }
  const fmt = (n: string): string => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Parafiscales</h1>
        <p className="text-sm text-muted-foreground">IVSS, RPE, FAOV e INCES por período; planillas TIUNA/FAOV/INCES (doc 04 §3).</p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <input className="w-24 rounded border px-2 py-1 text-sm" type="number" value={periodo.anio} onChange={(e) => setPeriodo({ ...periodo, anio: Number(e.target.value) })} />
        <input className="w-20 rounded border px-2 py-1 text-sm" type="number" min={1} max={12} value={periodo.mes} onChange={(e) => setPeriodo({ ...periodo, mes: Number(e.target.value) })} />
        <button onClick={() => calcular.mutate()} disabled={calcular.isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {calcular.isPending ? 'Calculando…' : 'Calcular período'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Régimen</th>
              <th className="px-3 py-2 text-right font-medium">Base (Bs)</th>
              <th className="px-3 py-2 text-right font-medium">Trabajador</th>
              <th className="px-3 py-2 text-right font-medium">Patrono</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 text-right font-medium">Planilla</th>
            </tr>
          </thead>
          <tbody>
            {lista.data?.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Sin liquidación; calcula el período.</td></tr>}
            {lista.data?.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{p.regimen}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(p.baseVes)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(p.montoTrabajadorVes)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(p.montoPatronoVes)}</td>
                <td className="px-3 py-2">{p.estadoPlanilla}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => descargar.mutate(p.regimen)} className="rounded border px-2 py-1 text-xs">Descargar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

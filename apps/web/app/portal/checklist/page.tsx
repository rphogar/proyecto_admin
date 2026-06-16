'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ChecklistEmpresa, portalApi } from '@/lib/portal-api';

const HOY = new Date();

/** Resumen de estado de una empresa en el checklist masivo. */
function estadoEmpresa(e: ChecklistEmpresa): { texto: string; clase: string } {
  if (e.yaCerrado) return { texto: 'Cerrada', clase: 'bg-emerald-100 text-emerald-700' };
  if (e.puedeCerrar) return { texto: 'Lista para cerrar', clase: 'bg-sky-100 text-sky-700' };
  return { texto: 'Con pendientes', clase: 'bg-amber-100 text-amber-700' };
}

/** Checklist de cierre masivo (doc 06 M11): corre el wizard de P13 por empresa, sin mutar nada. */
export default function PortalChecklistPage() {
  const [periodo, setPeriodo] = useState({ anio: HOY.getFullYear(), mes: HOY.getMonth() + 1 });
  const q = useQuery({
    queryKey: ['portal', 'checklist', periodo.anio, periodo.mes],
    queryFn: () => portalApi.checklist(periodo.anio, periodo.mes),
    staleTime: 15_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Checklist de cierre masivo</h1>
        <p className="text-sm text-muted-foreground">Evalúa el cierre del período en toda la cartera (lectura, no cierra nada).</p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Año</span>
          <input className="w-24 rounded border px-2 py-1 text-sm" type="number" value={periodo.anio} onChange={(e) => setPeriodo({ ...periodo, anio: Number(e.target.value) })} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Mes</span>
          <input className="w-20 rounded border px-2 py-1 text-sm" type="number" min={1} max={12} value={periodo.mes} onChange={(e) => setPeriodo({ ...periodo, mes: Number(e.target.value) })} />
        </label>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Evaluando la cartera…</p>}
      {q.isError && <p role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">No se pudo evaluar el checklist.</p>}

      {q.data && (
        <>
          <p className="text-sm text-muted-foreground">
            {q.data.totales.empresas} empresas · {q.data.totales.cerradas} cerradas · {q.data.totales.listas} listas para cerrar.
          </p>
          <div className="flex flex-col gap-3">
            {q.data.empresas.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No hay empresas en la cartera.</p>}
            {q.data.empresas.map((e) => {
              const b = estadoEmpresa(e);
              return (
                <section key={e.companyId} className="rounded-lg border">
                  <header className="flex items-center justify-between gap-2 border-b px-4 py-2">
                    <span>
                      <span className="font-medium">{e.razonSocial}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{e.rif}</span>
                    </span>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${b.clase}`}>{b.texto}</span>
                  </header>
                  <ul className="flex flex-col gap-1 px-4 py-3 text-sm">
                    {e.pasos.map((p) => (
                      <li key={p.clave} className="flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${p.estado === 'OK' || p.estado === 'NO_APLICA' ? 'bg-emerald-500' : p.bloqueante ? 'bg-red-500' : 'bg-muted-foreground/40'}`} aria-hidden />
                        <span>
                          <span className="text-muted-foreground">{p.paso}.</span> {p.detalle}
                          {!p.bloqueante && p.estado !== 'OK' && <span className="ml-1 text-xs text-muted-foreground">(no bloqueante)</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

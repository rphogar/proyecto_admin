'use client';

import { useQuery } from '@tanstack/react-query';
import { type ObligacionPortal, portalApi } from '@/lib/portal-api';

/** Color del punto según urgencia/estado de la obligación. */
function color(o: ObligacionPortal): string {
  if (o.estado === 'PRESENTADA') return 'bg-emerald-500';
  if (o.diasRestantes < 0) return 'bg-red-500';
  if (o.diasRestantes <= 5) return 'bg-amber-500';
  return 'bg-sky-500';
}

/** Calendario consolidado de obligaciones de toda la cartera (doc 06 M11, docs/02 §10). */
export default function PortalCalendarioPage() {
  const q = useQuery({ queryKey: ['portal', 'calendario'], queryFn: () => portalApi.calendario(), staleTime: 30_000 });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Calendario de obligaciones</h1>
        <p className="text-sm text-muted-foreground">Todas las empresas de la cartera, ordenadas por vencimiento (hora de Caracas).</p>
      </header>

      {q.isLoading && <p className="text-sm text-muted-foreground">Cargando obligaciones…</p>}
      {q.isError && <p role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">No se pudo cargar el calendario.</p>}

      {q.data && (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Vence</th>
                <th className="px-3 py-2 font-medium">Obligación</th>
                <th className="px-3 py-2 font-medium">Empresa</th>
                <th className="px-3 py-2 font-medium">Período</th>
                <th className="px-3 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {q.data.obligaciones.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sin obligaciones próximas.</td></tr>
              )}
              {q.data.obligaciones.map((o) => (
                <tr key={`${o.companyId}-${o.tipo}-${o.periodo}`} className="border-b last:border-0">
                  <td className="px-3 py-2 tabular-nums">
                    <span className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color(o)}`} aria-hidden />
                      {o.fechaLimite}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium">{o.tipo}</td>
                  <td className="px-3 py-2">
                    <span className="block">{o.razonSocial}</span>
                    <span className="text-xs text-muted-foreground">{o.rif}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{o.periodo}</td>
                  <td className="px-3 py-2">
                    {o.estado === 'PRESENTADA' ? (
                      <span className="text-emerald-600">presentada</span>
                    ) : o.diasRestantes < 0 ? (
                      <span className="text-red-600">vencida hace {-o.diasRestantes}d</span>
                    ) : (
                      <span className={o.diasRestantes <= 5 ? 'text-amber-600' : 'text-muted-foreground'}>
                        {o.diasRestantes === 0 ? 'vence hoy' : `en ${o.diasRestantes}d`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

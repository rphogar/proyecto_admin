'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { type EstadoCierreActual, portalApi } from '@/lib/portal-api';

/** Etiqueta y color del estado de cierre del período en curso. */
function badgeCierre(estado: EstadoCierreActual): { texto: string; clase: string } {
  switch (estado) {
    case 'CLOSED':
      return { texto: 'Cerrado', clase: 'bg-emerald-100 text-emerald-700' };
    case 'REABIERTO':
      return { texto: 'Reabierto', clase: 'bg-amber-100 text-amber-700' };
    case 'OPEN':
      return { texto: 'Abierto', clase: 'bg-sky-100 text-sky-700' };
    default:
      return { texto: 'Sin período', clase: 'bg-muted text-muted-foreground' };
  }
}

/** Panel multi-empresa del contador (doc 06 M11): estado de cierres y obligaciones por empresa. */
export default function PortalPanelPage() {
  const q = useQuery({ queryKey: ['portal', 'panel'], queryFn: () => portalApi.panel(), staleTime: 30_000 });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Mi cartera</h1>
        {q.data && <p className="text-sm text-muted-foreground">Período {q.data.periodoActual} · al {q.data.fecha} · datos en vivo</p>}
      </header>

      {q.isLoading && <p className="text-sm text-muted-foreground">Cargando la cartera…</p>}
      {q.isError && <p role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">No se pudo cargar el panel.</p>}

      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tarjeta titulo="Empresas" valor={q.data.totales.empresas} />
            <Tarjeta titulo="Cierres pendientes" valor={q.data.totales.cierresPendientes} acento={q.data.totales.cierresPendientes > 0} />
            <Tarjeta titulo="Obligaciones pendientes" valor={q.data.totales.obligacionesPendientes} />
            <Tarjeta titulo="Vencidas" valor={q.data.totales.obligacionesVencidas} acento={q.data.totales.obligacionesVencidas > 0} />
          </div>

          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Empresa</th>
                  <th className="px-3 py-2 font-medium">Cierre {q.data.periodoActual}</th>
                  <th className="px-3 py-2 font-medium">Último cerrado</th>
                  <th className="px-3 py-2 text-center font-medium">Abiertos</th>
                  <th className="px-3 py-2 font-medium">Próxima obligación</th>
                </tr>
              </thead>
              <tbody>
                {q.data.empresas.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No hay empresas en esta cartera todavía.</td></tr>
                )}
                {q.data.empresas.map((e) => {
                  const b = badgeCierre(e.cierre.estadoActual);
                  const prox = e.obligaciones.proxima;
                  return (
                    <tr key={e.companyId} className="border-b last:border-0 align-top">
                      <td className="px-3 py-2">
                        <span className="block font-medium">{e.razonSocial}</span>
                        <span className="text-xs text-muted-foreground">{e.rif} · {e.tipoContribuyente}{e.spe ? ' · SPE' : ''}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${b.clase}`}>{b.texto}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{e.cierre.ultimoCerrado ?? '—'}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{e.cierre.periodosAbiertos}</td>
                      <td className="px-3 py-2">
                        {prox === null ? (
                          <span className="text-emerald-600">al día</span>
                        ) : (
                          <span>
                            {prox.tipo} {prox.periodo}
                            <span className={`ml-1 text-xs ${prox.diasRestantes < 0 ? 'text-red-600' : prox.diasRestantes <= 5 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                              {prox.diasRestantes < 0 ? `vencida hace ${-prox.diasRestantes}d` : prox.diasRestantes === 0 ? 'vence hoy' : `en ${prox.diasRestantes}d`}
                            </span>
                            {e.obligaciones.pendientes > 1 && <span className="ml-1 text-xs text-muted-foreground">(+{e.obligaciones.pendientes - 1})</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-muted-foreground">
            Ver el <Link href="/portal/calendario" className="underline">calendario consolidado</Link> o correr el{' '}
            <Link href="/portal/checklist" className="underline">checklist de cierre masivo</Link>.
          </p>
        </>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, acento }: { titulo: string; valor: number; acento?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${acento ? 'text-amber-600' : ''}`}>{valor}</p>
    </div>
  );
}

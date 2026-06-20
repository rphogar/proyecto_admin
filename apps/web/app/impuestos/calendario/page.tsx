'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { impuestosApi } from '@/lib/impuestos-api';

const ahora = new Date();

/** Calendario SPE por dígito terminal de RIF (datos por providencia anual, regla 17; doc 06 M7). */
export default function CalendarioSpePage() {
  const [anio, setAnio] = useState(ahora.getFullYear());

  const q = useQuery({
    queryKey: ['impuestos', 'calendario-spe', anio],
    queryFn: () => impuestosApi.calendarioSpe(anio),
  });

  const entradas = q.data?.entradas ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Calendario SPE</h1>
        <p className="text-sm text-muted-foreground">
          Fechas límite por dígito terminal del RIF. Se importa cada año como datos de la providencia (nunca hardcodeado).
        </p>
      </header>

      <label className="flex w-28 flex-col text-sm">
        <span className="text-muted-foreground">Año</span>
        <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} className="rounded-md border px-3 py-1.5" />
      </label>

      {q.isLoading && <p className="text-sm text-muted-foreground">Cargando calendario…</p>}
      {q.isError && <p role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">No se pudo cargar el calendario.</p>}

      {q.data && (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Terminal RIF</th>
                <th className="px-3 py-2 font-medium">Obligación</th>
                <th className="px-3 py-2 font-medium">Período</th>
                <th className="px-3 py-2 font-medium">Fracción</th>
                <th className="px-3 py-2 font-medium">Vence</th>
              </tr>
            </thead>
            <tbody>
              {entradas.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sin calendario importado para {anio}.</td></tr>
              )}
              {entradas
                .slice()
                .sort((a, b) => a.fechaLimite.localeCompare(b.fechaLimite) || a.terminalRif.localeCompare(b.terminalRif))
                .map((e, i) => (
                  <tr key={`${e.terminalRif}-${e.tipo}-${e.periodoAnio}-${e.periodoMes}-${e.subperiodo ?? 0}-${i}`} className="border-b last:border-0">
                    <td className="px-3 py-2 tabular-nums">{e.terminalRif}</td>
                    <td className="px-3 py-2">{e.tipo}</td>
                    <td className="px-3 py-2 tabular-nums">{e.periodoAnio}-{String(e.periodoMes).padStart(2, '0')}</td>
                    <td className="px-3 py-2 tabular-nums">{e.subperiodo ? e.subperiodo : '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{e.fechaLimite}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

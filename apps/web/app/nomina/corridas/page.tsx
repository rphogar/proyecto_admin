'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { type Corrida, nominaApi } from '@/lib/nomina-api';

const HOY = new Date();

/** Corridas de nómina (doc 04 §5): pre-nómina → aprobación → contabilización. */
export default function CorridasPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [form, setForm] = useState({ anio: HOY.getFullYear(), mes: HOY.getMonth() + 1, frecuencia: 'MENSUAL', fechaInicio: '', fechaFin: '', rateBcv: '' });
  const [error, setError] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['nomina', 'corridas', companyId],
    queryFn: () => nominaApi.listarCorridas(companyId as string),
    enabled: companyId !== null,
  });

  const invalidar = () => void qc.invalidateQueries({ queryKey: ['nomina', 'corridas', companyId] });

  const crear = useMutation({
    mutationFn: () =>
      nominaApi.crearCorrida({
        companyId,
        anio: form.anio,
        mes: form.mes,
        frecuencia: form.frecuencia,
        periodoEtiqueta: `${form.anio}-${String(form.mes).padStart(2, '0')}-${form.frecuencia[0]}`,
        fechaInicio: form.fechaInicio,
        fechaFin: form.fechaFin,
        rateBcv: form.rateBcv,
      }),
    onSuccess: () => {
      setError(null);
      invalidar();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error al crear'),
  });

  const aprobar = useMutation({ mutationFn: (id: string) => nominaApi.aprobarCorrida({ companyId: companyId as string, id }), onSuccess: invalidar, onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error') });
  const contabilizar = useMutation({ mutationFn: (id: string) => nominaApi.contabilizarCorrida({ companyId: companyId as string, id }), onSuccess: invalidar, onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error') });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  const fmt = (n: string): string => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Corridas de nómina</h1>
        <p className="text-sm text-muted-foreground">Genera la pre-nómina, apruébala y contabilízala (doc 04 §5).</p>
      </header>

      <form className="grid grid-cols-3 gap-3 rounded-lg border p-4" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
        <input className="rounded border px-2 py-1 text-sm" type="number" placeholder="Año" value={form.anio} onChange={(e) => setForm({ ...form, anio: Number(e.target.value) })} required />
        <input className="rounded border px-2 py-1 text-sm" type="number" min={1} max={12} placeholder="Mes" value={form.mes} onChange={(e) => setForm({ ...form, mes: Number(e.target.value) })} required />
        <select className="rounded border px-2 py-1 text-sm" value={form.frecuencia} onChange={(e) => setForm({ ...form, frecuencia: e.target.value })}>
          <option value="MENSUAL">Mensual</option>
          <option value="QUINCENAL">Quincenal</option>
          <option value="SEMANAL">Semanal</option>
        </select>
        <input className="rounded border px-2 py-1 text-sm" type="date" value={form.fechaInicio} onChange={(e) => setForm({ ...form, fechaInicio: e.target.value })} required />
        <input className="rounded border px-2 py-1 text-sm" type="date" value={form.fechaFin} onChange={(e) => setForm({ ...form, fechaFin: e.target.value })} required />
        <input className="rounded border px-2 py-1 text-sm" placeholder="Tasa BCV (Bs/USD)" value={form.rateBcv} onChange={(e) => setForm({ ...form, rateBcv: e.target.value })} required />
        <div className="col-span-3 flex items-center gap-3">
          <button type="submit" disabled={crear.isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {crear.isPending ? 'Calculando…' : 'Generar pre-nómina'}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Período</th>
              <th className="px-3 py-2 font-medium">Frecuencia</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 text-right font-medium">Neto (Bs)</th>
              <th className="px-3 py-2 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {lista.data?.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sin corridas todavía.</td></tr>}
            {lista.data?.map((c: Corrida) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-3 py-2">{c.periodoEtiqueta}</td>
                <td className="px-3 py-2">{c.frecuencia}</td>
                <td className="px-3 py-2">{c.estado}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(c.totalNeto)}</td>
                <td className="px-3 py-2 text-right">
                  {c.estado === 'BORRADOR' && <button onClick={() => aprobar.mutate(c.id)} className="rounded border px-2 py-1 text-xs">Aprobar</button>}
                  {c.estado === 'APROBADA' && <button onClick={() => contabilizar.mutate(c.id)} className="rounded border px-2 py-1 text-xs">Contabilizar</button>}
                  {c.estado === 'CONTABILIZADA' && <span className="text-xs text-green-700">Contabilizada</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

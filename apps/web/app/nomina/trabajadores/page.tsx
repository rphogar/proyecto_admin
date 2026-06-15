'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { nominaApi } from '@/lib/nomina-api';

/** Fichas de trabajadores (doc 06 M8): listado y alta con salario (mixto opcional). */
export default function TrabajadoresPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [form, setForm] = useState({ cedula: '', nombre: '', cargo: '', fechaIngreso: '', salarioNormalMensual: '', salarioMonedaExtra: '', salarioMontoExtra: '' });
  const [error, setError] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['nomina', 'trabajadores', companyId],
    queryFn: () => nominaApi.listarTrabajadores(companyId as string),
    enabled: companyId !== null,
  });

  const crear = useMutation({
    mutationFn: () =>
      nominaApi.crearTrabajador({
        companyId,
        cedula: form.cedula,
        nombre: form.nombre,
        cargo: form.cargo || undefined,
        fechaIngreso: form.fechaIngreso,
        frecuenciaPago: 'QUINCENAL',
        salarioNormalMensual: form.salarioNormalMensual,
        salarioMonedaExtra: form.salarioMonedaExtra || undefined,
        salarioMontoExtra: form.salarioMontoExtra || undefined,
      }),
    onSuccess: () => {
      setError(null);
      setForm({ cedula: '', nombre: '', cargo: '', fechaIngreso: '', salarioNormalMensual: '', salarioMonedaExtra: '', salarioMontoExtra: '' });
      void qc.invalidateQueries({ queryKey: ['nomina', 'trabajadores', companyId] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error al crear'),
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Trabajadores</h1>
        <p className="text-sm text-muted-foreground">Fichas del personal: datos, salario y antigüedad (doc 04 §5).</p>
      </header>

      <form
        className="grid grid-cols-2 gap-3 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          crear.mutate();
        }}
      >
        <input className="rounded border px-2 py-1 text-sm" placeholder="Cédula/RIF" value={form.cedula} onChange={(e) => setForm({ ...form, cedula: e.target.value })} required />
        <input className="rounded border px-2 py-1 text-sm" placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
        <input className="rounded border px-2 py-1 text-sm" placeholder="Cargo" value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} />
        <input className="rounded border px-2 py-1 text-sm" type="date" placeholder="Fecha ingreso" value={form.fechaIngreso} onChange={(e) => setForm({ ...form, fechaIngreso: e.target.value })} required />
        <input className="rounded border px-2 py-1 text-sm" placeholder="Salario mensual (Bs)" value={form.salarioNormalMensual} onChange={(e) => setForm({ ...form, salarioNormalMensual: e.target.value })} required />
        <div className="grid grid-cols-2 gap-2">
          <input className="rounded border px-2 py-1 text-sm" placeholder="Moneda extra (USD)" value={form.salarioMonedaExtra} onChange={(e) => setForm({ ...form, salarioMonedaExtra: e.target.value })} />
          <input className="rounded border px-2 py-1 text-sm" placeholder="Monto extra" value={form.salarioMontoExtra} onChange={(e) => setForm({ ...form, salarioMontoExtra: e.target.value })} />
        </div>
        <div className="col-span-2 flex items-center gap-3">
          <button type="submit" disabled={crear.isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {crear.isPending ? 'Guardando…' : 'Agregar trabajador'}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Cédula/RIF</th>
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 font-medium">Cargo</th>
              <th className="px-3 py-2 font-medium">Ingreso</th>
              <th className="px-3 py-2 text-right font-medium">Salario (Bs)</th>
            </tr>
          </thead>
          <tbody>
            {lista.data?.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sin trabajadores todavía.</td></tr>}
            {lista.data?.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-mono text-xs">{t.cedula}</td>
                <td className="px-3 py-2">{t.nombre}</td>
                <td className="px-3 py-2">{t.cargo ?? '—'}</td>
                <td className="px-3 py-2">{t.fechaIngreso}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(t.salarioNormalMensual).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

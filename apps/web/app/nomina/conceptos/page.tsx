'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { nominaApi } from '@/lib/nomina-api';

/** Conceptos de nómina con fórmulas seguras (doc 04 §5): alta con validación de fórmula en vivo. */
export default function ConceptosPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [form, setForm] = useState({ codigo: '', nombre: '', tipo: 'ASIGNACION', formula: '', salarial: false });
  const [errores, setErrores] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['nomina', 'conceptos', companyId],
    queryFn: () => nominaApi.listarConceptos(companyId as string),
    enabled: companyId !== null,
  });

  const validar = useMutation({
    mutationFn: () => nominaApi.validarConcepto({ formula: form.formula }),
    onSuccess: (r) => setErrores(r.errores),
  });

  const crear = useMutation({
    mutationFn: () => nominaApi.crearConcepto({ companyId, codigo: form.codigo, nombre: form.nombre, tipo: form.tipo, formula: form.formula, salarial: form.salarial }),
    onSuccess: () => {
      setError(null);
      setErrores([]);
      setForm({ codigo: '', nombre: '', tipo: 'ASIGNACION', formula: '', salarial: false });
      void qc.invalidateQueries({ queryKey: ['nomina', 'conceptos', companyId] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error al crear'),
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Conceptos</h1>
        <p className="text-sm text-muted-foreground">Asignaciones y deducciones con fórmulas seguras (variables como <code>salario_diario</code>, <code>dias</code>; funciones <code>min/max/round/if</code>).</p>
      </header>

      <form
        className="grid grid-cols-2 gap-3 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          crear.mutate();
        }}
      >
        <input className="rounded border px-2 py-1 text-sm" placeholder="Código" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} required />
        <input className="rounded border px-2 py-1 text-sm" placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
        <select className="rounded border px-2 py-1 text-sm" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
          <option value="ASIGNACION">Asignación</option>
          <option value="DEDUCCION">Deducción</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.salarial} onChange={(e) => setForm({ ...form, salarial: e.target.checked })} /> Integra el salario
        </label>
        <input className="col-span-2 rounded border px-2 py-1 font-mono text-sm" placeholder="Fórmula (p.ej. salario_diario * dias)" value={form.formula} onChange={(e) => setForm({ ...form, formula: e.target.value })} required />
        {errores.length > 0 && <p className="col-span-2 text-sm text-red-600">{errores.join(' ')}</p>}
        {errores.length === 0 && validar.isSuccess && <p className="col-span-2 text-sm text-green-700">Fórmula válida.</p>}
        <div className="col-span-2 flex items-center gap-3">
          <button type="button" onClick={() => validar.mutate()} className="rounded-md border px-4 py-1.5 text-sm">Validar fórmula</button>
          <button type="submit" disabled={crear.isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {crear.isPending ? 'Guardando…' : 'Agregar concepto'}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Fórmula</th>
            </tr>
          </thead>
          <tbody>
            {lista.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Sin conceptos todavía.</td></tr>}
            {lista.data?.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-mono text-xs">{c.codigo}</td>
                <td className="px-3 py-2">{c.nombre}</td>
                <td className="px-3 py-2">{c.tipo === 'ASIGNACION' ? 'Asignación' : 'Deducción'}</td>
                <td className="px-3 py-2 font-mono text-xs">{c.formula}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

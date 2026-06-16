'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { portalApi } from '@/lib/portal-api';

/**
 * Catálogo de permisos delegables (subconjunto representativo del catálogo `permissions`). El
 * enforcement por endpoint lo cablean los guards de auth; aquí el dueño elige qué acciones concede
 * a su contador por empresa.
 */
const PERMISOS_DELEGABLES = [
  { code: 'portal.view', etiqueta: 'Ver el portal' },
  { code: 'contabilidad.ver', etiqueta: 'Ver contabilidad' },
  { code: 'contabilidad.cerrar', etiqueta: 'Cerrar período' },
  { code: 'impuestos.declarar', etiqueta: 'Presentar declaraciones' },
  { code: 'nomina.view', etiqueta: 'Ver nómina' },
  { code: 'nomina.aprobar', etiqueta: 'Aprobar nómina' },
] as const;

/** Delegaciones de permisos por empresa (doc 06 M11): el dueño concede acciones a su contador. */
export default function PortalDelegacionesPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [userId, setUserId] = useState('');
  const [permisos, setPermisos] = useState<Set<string>>(new Set(['portal.view']));
  const [error, setError] = useState<string | null>(null);

  const lista = useQuery({ queryKey: ['portal', 'delegaciones'], queryFn: () => portalApi.listarDelegaciones() });

  const otorgar = useMutation({
    mutationFn: () => portalApi.otorgar({ companyId: companyId.trim(), userId: userId.trim(), permisos: [...permisos] }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['portal', 'delegaciones'] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error'),
  });

  const revocar = useMutation({
    mutationFn: (id: string) => portalApi.revocar(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal', 'delegaciones'] }),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error'),
  });

  const toggle = (code: string) => {
    setPermisos((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Delegaciones de permisos</h1>
        <p className="text-sm text-muted-foreground">El dueño de cada empresa concede a su contador qué acciones puede ejecutar (regla 13).</p>
      </header>

      <form
        className="flex flex-col gap-3 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (companyId.trim() && userId.trim() && permisos.size > 0) otorgar.mutate();
        }}
      >
        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Empresa (UUID)</span>
            <input className="w-80 rounded border px-2 py-1 text-sm" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="company_id" />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Contador (UUID de usuario)</span>
            <input className="w-80 rounded border px-2 py-1 text-sm" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user_id" />
          </label>
        </div>
        <fieldset className="flex flex-wrap gap-3">
          {PERMISOS_DELEGABLES.map((p) => (
            <label key={p.code} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={permisos.has(p.code)} onChange={() => toggle(p.code)} />
              {p.etiqueta}
            </label>
          ))}
        </fieldset>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={otorgar.isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {otorgar.isPending ? 'Otorgando…' : 'Otorgar delegación'}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Empresa</th>
              <th className="px-3 py-2 font-medium">Usuario</th>
              <th className="px-3 py-2 font-medium">Permisos</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 text-right font-medium">Acción</th>
            </tr>
          </thead>
          <tbody>
            {lista.data?.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sin delegaciones todavía.</td></tr>}
            {lista.data?.map((d) => (
              <tr key={d.id} className="border-b last:border-0 align-top">
                <td className="px-3 py-2 font-mono text-xs">{d.companyId}</td>
                <td className="px-3 py-2 font-mono text-xs">{d.userId}</td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-1">
                    {d.permisos.map((p) => <span key={p} className="rounded bg-muted px-1.5 py-0.5 text-xs">{p}</span>)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${d.estado === 'ACTIVA' ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>{d.estado}</span>
                </td>
                <td className="px-3 py-2 text-right">
                  {d.estado === 'ACTIVA' && (
                    <button onClick={() => revocar.mutate(d.id)} disabled={revocar.isPending} className="rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
                      Revocar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

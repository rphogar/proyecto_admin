'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { ApiError } from '@/lib/maestros-api';
import { paymentMethodsApi } from '@/lib/maestros-api';
import { tesoreriaApi } from '@/lib/tesoreria-api';

/** Cierres de caja por turno con arqueo por método (doc 06 M1/M4). */
export default function CierresCajaPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [declarado, setDeclarado] = useState<Record<string, string>>({});
  const [rateBcv, setRateBcv] = useState('');
  const [rateUsdMgmt, setRateUsdMgmt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cierres = useQuery({
    queryKey: ['tesoreria', 'cierres', companyId],
    queryFn: () => tesoreriaApi.listarCierres(companyId as string),
    enabled: companyId !== null,
  });
  const metodos = useQuery({
    queryKey: ['payment-methods', companyId],
    queryFn: () => paymentMethodsApi.listar(companyId as string),
    enabled: companyId !== null,
  });

  const abrir = useMutation({
    mutationFn: () => tesoreriaApi.abrirCaja(companyId as string),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tesoreria', 'cierres'] }),
  });
  const cerrar = useMutation({
    mutationFn: (cierreId: string) =>
      tesoreriaApi.cerrarCaja({
        cierreId,
        companyId: companyId as string,
        rateBcv: rateBcv || null,
        rateUsdMgmt,
        conteos: (metodos.data ?? []).map((m) => ({ paymentMethodId: m.id, montoDeclarado: declarado[m.id] ?? '0' })),
      }),
    onSuccess: () => {
      setDeclarado({});
      setError(null);
      void qc.invalidateQueries({ queryKey: ['tesoreria'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo cerrar el turno'),
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  const abierto = cierres.data?.find((c) => c.status === 'ABIERTO');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cierres de caja</h1>
          <p className="text-sm text-muted-foreground">Arqueo por método: lo esperado por el sistema vs lo declarado (doc 06 M4, caso 5).</p>
        </div>
        {!abierto && (
          <Button onClick={() => abrir.mutate()} disabled={abrir.isPending}>{abrir.isPending ? 'Abriendo…' : 'Abrir caja'}</Button>
        )}
      </header>

      {abierto && (
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Cerrar turno abierto (desde {new Date(abierto.apertura).toLocaleString('es-VE')})</h2>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Método</th>
                  <th className="px-3 py-2 font-medium">Moneda</th>
                  <th className="px-3 py-2 font-medium">Declarado (arqueo físico)</th>
                </tr>
              </thead>
              <tbody>
                {metodos.data?.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{m.nombre}</td>
                    <td className="px-3 py-2">{m.moneda}</td>
                    <td className="px-3 py-2">
                      <Input value={declarado[m.id] ?? ''} onChange={(e) => setDeclarado((d) => ({ ...d, [m.id]: e.target.value }))} placeholder="0.00" className="w-40" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <Input placeholder="Tasa BCV (métodos USD)" value={rateBcv} onChange={(e) => setRateBcv(e.target.value)} className="w-48" />
            <Input placeholder="Tasa gerencial Bs/USD" value={rateUsdMgmt} onChange={(e) => setRateUsdMgmt(e.target.value)} className="w-48" />
            <Button onClick={() => cerrar.mutate(abierto.id)} disabled={cerrar.isPending}>{cerrar.isPending ? 'Cerrando…' : 'Cerrar caja'}</Button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </section>
      )}

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Apertura</th>
              <th className="px-3 py-2 font-medium">Cierre</th>
              <th className="px-3 py-2 text-right font-medium">Diferencia Bs</th>
              <th className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {cierres.isLoading && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Cargando…</td></tr>}
            {cierres.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Sin cierres todavía.</td></tr>}
            {cierres.data?.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-3 py-2">{new Date(c.apertura).toLocaleString('es-VE')}</td>
                <td className="px-3 py-2">{c.cierre ? new Date(c.cierre).toLocaleString('es-VE') : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.totalDiferenciaVes ?? '—'}</td>
                <td className="px-3 py-2">{c.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

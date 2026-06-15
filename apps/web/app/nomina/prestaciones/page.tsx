'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { nominaApi, type ResultadoLiquidacion } from '@/lib/nomina-api';

/** Kardex de prestaciones (append-only) y liquidación con doble cálculo art. 142 (doc 04 §2.3). */
export default function PrestacionesPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [trabajadorId, setTrabajadorId] = useState('');
  const [mov, setMov] = useState({ tipo: 'DEPOSITO_TRIMESTRAL', montoVes: '', fecha: '' });
  const [liq, setLiq] = useState({ antiguedadAnios: '', salarioIntegralDiarioFinal: '', adelantos: '', despidoInjustificado: false });
  const [resultado, setResultado] = useState<ResultadoLiquidacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trabajadores = useQuery({
    queryKey: ['nomina', 'trabajadores', companyId],
    queryFn: () => nominaApi.listarTrabajadores(companyId as string),
    enabled: companyId !== null,
  });

  const kardex = useQuery({
    queryKey: ['nomina', 'kardex', companyId, trabajadorId],
    queryFn: () => nominaApi.kardex(companyId as string, trabajadorId),
    enabled: companyId !== null && trabajadorId !== '',
  });

  const registrar = useMutation({
    mutationFn: () => nominaApi.registrarMovimiento({ companyId, trabajadorId, tipo: mov.tipo, montoVes: mov.montoVes, fecha: mov.fecha || undefined }),
    onSuccess: () => { setError(null); setMov({ tipo: 'DEPOSITO_TRIMESTRAL', montoVes: '', fecha: '' }); void qc.invalidateQueries({ queryKey: ['nomina', 'kardex', companyId, trabajadorId] }); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error'),
  });

  const liquidar = useMutation({
    mutationFn: () => nominaApi.liquidar({ companyId, trabajadorId, antiguedadAnios: liq.antiguedadAnios, salarioIntegralDiarioFinal: liq.salarioIntegralDiarioFinal, adelantos: liq.adelantos || undefined, despidoInjustificado: liq.despidoInjustificado }),
    onSuccess: (r) => { setError(null); setResultado(r); void qc.invalidateQueries({ queryKey: ['nomina', 'kardex', companyId, trabajadorId] }); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error'),
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }
  const fmt = (n: string): string => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Prestaciones sociales</h1>
        <p className="text-sm text-muted-foreground">Kardex de garantía (art. 142) y asistente de liquidación (doble cálculo).</p>
      </header>

      <select className="w-80 rounded border px-2 py-1 text-sm" value={trabajadorId} onChange={(e) => { setTrabajadorId(e.target.value); setResultado(null); }}>
        <option value="">Selecciona un trabajador…</option>
        {trabajadores.data?.map((t) => <option key={t.id} value={t.id}>{t.nombre} ({t.cedula})</option>)}
      </select>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {trabajadorId !== '' && (
        <>
          <section className="rounded-lg border p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Registrar movimiento</h2>
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); registrar.mutate(); }}>
              <select className="rounded border px-2 py-1 text-sm" value={mov.tipo} onChange={(e) => setMov({ ...mov, tipo: e.target.value })}>
                <option value="DEPOSITO_TRIMESTRAL">Depósito trimestral</option>
                <option value="DIAS_ADICIONALES">Días adicionales</option>
                <option value="INTERES">Interés</option>
                <option value="ADELANTO">Adelanto</option>
              </select>
              <input className="rounded border px-2 py-1 text-sm" placeholder="Monto (Bs)" value={mov.montoVes} onChange={(e) => setMov({ ...mov, montoVes: e.target.value })} required />
              <input className="rounded border px-2 py-1 text-sm" type="date" value={mov.fecha} onChange={(e) => setMov({ ...mov, fecha: e.target.value })} />
              <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Registrar</button>
            </form>
          </section>

          <section className="rounded-lg border">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-2 font-medium">Fecha</th><th className="px-3 py-2 font-medium">Tipo</th><th className="px-3 py-2 text-right font-medium">Monto (Bs)</th><th className="px-3 py-2 text-right font-medium">Saldo garantía</th></tr></thead>
              <tbody>
                {kardex.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Sin movimientos.</td></tr>}
                {kardex.data?.map((m) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{new Date(m.fecha).toLocaleDateString('es-VE')}</td>
                    <td className="px-3 py-2">{m.tipo}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(m.montoVes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.saldoGarantiaVes ? fmt(m.saldoGarantiaVes) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-lg border p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Liquidar (art. 142)</h2>
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); liquidar.mutate(); }}>
              <input className="rounded border px-2 py-1 text-sm" placeholder="Años de antigüedad" value={liq.antiguedadAnios} onChange={(e) => setLiq({ ...liq, antiguedadAnios: e.target.value })} required />
              <input className="rounded border px-2 py-1 text-sm" placeholder="Salario integral diario final" value={liq.salarioIntegralDiarioFinal} onChange={(e) => setLiq({ ...liq, salarioIntegralDiarioFinal: e.target.value })} required />
              <input className="rounded border px-2 py-1 text-sm" placeholder="Anticipos (opcional)" value={liq.adelantos} onChange={(e) => setLiq({ ...liq, adelantos: e.target.value })} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={liq.despidoInjustificado} onChange={(e) => setLiq({ ...liq, despidoInjustificado: e.target.checked })} /> Despido injustificado (art. 92)</label>
              <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Calcular liquidación</button>
            </form>

            {resultado && (
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <p>Vía garantía: <span className="tabular-nums">Bs {fmt(resultado.calculo.viaGarantia)}</span></p>
                <p>Vía retroactiva: <span className="tabular-nums">Bs {fmt(resultado.calculo.viaRetroactiva)}</span></p>
                <p>Base mayor: <strong>{resultado.calculo.baseMayor}</strong></p>
                <p>Prestaciones a cancelar: <span className="tabular-nums">Bs {fmt(resultado.calculo.prestacionesACancelar)}</span></p>
                <p>Indemnización art. 92: <span className="tabular-nums">Bs {fmt(resultado.calculo.indemnizacionArt92)}</span></p>
                <p className="font-semibold">Total a pagar: <span className="tabular-nums">Bs {fmt(resultado.calculo.totalAPagar)}</span></p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

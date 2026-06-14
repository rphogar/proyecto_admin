'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { tesoreriaApi } from '@/lib/tesoreria-api';

type Vista = 'VES' | 'USD';

function monto(vista: Vista, ves: string, usd: string): string {
  const v = vista === 'VES' ? ves : usd;
  const n = Number(v);
  return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
}

/** Posición consolidada de tesorería (doc 06 M4): saldos por cuenta/método/moneda, total en VES/USD. */
export default function PosicionPage() {
  const { companyId } = useEmpresaActiva();
  const [vista, setVista] = useState<Vista>('USD');
  const pos = useQuery({
    queryKey: ['tesoreria', 'posicion', companyId],
    queryFn: () => tesoreriaApi.posicion(companyId as string),
    enabled: companyId !== null,
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  const simbolo = vista === 'VES' ? 'Bs' : '$';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Posición consolidada</h1>
          <p className="text-sm text-muted-foreground">Saldos de caja y bancos derivados del ledger (doc 06 M4).</p>
        </div>
        <div className="inline-flex overflow-hidden rounded-md border text-sm">
          {(['VES', 'USD'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              className={`px-3 py-1.5 ${vista === v ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground'}`}
            >
              {v === 'VES' ? 'Bs' : 'USD'}
            </button>
          ))}
        </div>
      </header>

      {pos.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {pos.isError && <p className="text-sm text-red-600">No se pudo cargar la posición.</p>}

      {pos.data && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total consolidado (USD)</p>
              <p className="mt-1 text-2xl font-semibold">${monto('USD', pos.data.totalVes, pos.data.totalUsd)}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Total consolidado (Bs)</p>
              <p className="mt-1 text-2xl font-semibold">Bs {monto('VES', pos.data.totalVes, pos.data.totalUsd)}</p>
            </div>
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Por cuenta</h2>
            <div className="rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Código</th>
                    <th className="px-3 py-2 font-medium">Cuenta</th>
                    <th className="px-3 py-2 font-medium">Moneda</th>
                    <th className="px-3 py-2 text-right font-medium">Saldo ({simbolo})</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.data.cuentas.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Sin movimientos de caja/banco todavía.</td></tr>
                  )}
                  {pos.data.cuentas.map((c) => (
                    <tr key={c.codigo} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{c.codigo}</td>
                      <td className="px-3 py-2">{c.nombre}</td>
                      <td className="px-3 py-2">{c.moneda ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{monto(vista, c.saldoVes, c.saldoUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {pos.data.bancos.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cuentas bancarias</h2>
              <div className="rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Banco</th>
                      <th className="px-3 py-2 font-medium">Cuenta</th>
                      <th className="px-3 py-2 font-medium">Moneda</th>
                      <th className="px-3 py-2 text-right font-medium">Saldo ({simbolo})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pos.data.bancos.map((b) => (
                      <tr key={b.id} className="border-b last:border-0">
                        <td className="px-3 py-2">{b.banco}</td>
                        <td className="px-3 py-2">{b.nombre}</td>
                        <td className="px-3 py-2">{b.moneda}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{monto(vista, b.saldoVes, b.saldoUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

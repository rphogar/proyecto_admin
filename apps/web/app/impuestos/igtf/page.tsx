'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PeriodoSelector, PresentarBloque, Renglon } from '@/components/impuestos/comunes';
import { impuestosApi } from '@/lib/impuestos-api';
import { useEmpresaActiva } from '@/lib/empresa-activa';

const ahora = new Date();

/** Declaración borrador de IGTF percibido del período (doc 06 M7, docs/02 §5). Causado al pago. */
export default function DeclaracionIgtfPage() {
  const { companyId } = useEmpresaActiva();
  const [anio, setAnio] = useState(ahora.getFullYear());
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [numero, setNumero] = useState('');
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['impuestos', 'igtf', companyId, anio, mes],
    queryFn: () => impuestosApi.declaracionIgtf(companyId as string, anio, mes),
    enabled: companyId !== null,
  });

  const presentar = useMutation({
    mutationFn: () => impuestosApi.presentar({ companyId: companyId as string, tipo: 'IGTF', anio, mes, numeroDeclaracion: numero || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['impuestos'] }),
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  const d = q.data?.declaracion;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">IGTF percibido</h1>
        <p className="text-sm text-muted-foreground">Percepción sobre la porción de pagos en divisas (causada al cobro). Base fiscal VES.</p>
      </header>

      <PeriodoSelector anio={anio} mes={mes} onAnio={setAnio} onMes={setMes} />

      {q.isLoading && <p className="text-sm text-muted-foreground">Calculando declaración…</p>}
      {q.isError && <p role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">No se pudo calcular la declaración.</p>}

      {q.data && d && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Renglon etiqueta="Base imponible (divisas) Bs" valor={d.baseTotalVes} />
            <Renglon etiqueta="IGTF a enterar Bs" valor={d.igtfTotalVes} destacado />
            <Renglon etiqueta="Operaciones" valor={String(d.operaciones)} />
          </div>

          <div className="rounded-lg border">
            <p className="border-b px-3 py-2 text-sm font-medium">Detalle por alícuota</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Alícuota</th>
                  <th className="px-3 py-2 font-medium">Base Bs</th>
                  <th className="px-3 py-2 font-medium">IGTF Bs</th>
                  <th className="px-3 py-2 font-medium">Operaciones</th>
                </tr>
              </thead>
              <tbody>
                {d.grupos.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">Sin percepciones en el período.</td></tr>}
                {d.grupos.map((g) => (
                  <tr key={g.alicuota} className="border-b last:border-0">
                    <td className="px-3 py-2">{g.alicuota}%</td>
                    <td className="px-3 py-2 tabular-nums">{g.baseVes}</td>
                    <td className="px-3 py-2 tabular-nums">{g.igtfVes}</td>
                    <td className="px-3 py-2 tabular-nums">{g.operaciones}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <PresentarBloque
            numero={numero}
            onNumero={setNumero}
            onPresentar={() => presentar.mutate()}
            pendiente={presentar.isPending}
            error={presentar.isError ? (presentar.error as Error).message : null}
            ok={presentar.isSuccess}
          />
        </>
      )}
    </div>
  );
}

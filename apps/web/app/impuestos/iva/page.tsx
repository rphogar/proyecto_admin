'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PeriodoSelector, PresentarBloque, Renglon } from '@/components/impuestos/comunes';
import { impuestosApi } from '@/lib/impuestos-api';
import { useEmpresaActiva } from '@/lib/empresa-activa';

const ahora = new Date();

/** Planilla borrador de IVA (forma 99030, doc 06 M7): débitos, créditos con prorrata, retenciones y cuota. */
export default function PlanillaIvaPage() {
  const { companyId } = useEmpresaActiva();
  const [anio, setAnio] = useState(ahora.getFullYear());
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [numero, setNumero] = useState('');
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['impuestos', 'iva', companyId, anio, mes],
    queryFn: () => impuestosApi.planillaIva(companyId as string, anio, mes),
    enabled: companyId !== null,
  });

  const presentar = useMutation({
    mutationFn: () => impuestosApi.presentar({ companyId: companyId as string, tipo: 'IVA', anio, mes, numeroDeclaracion: numero || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['impuestos'] }),
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  const p = q.data?.planilla;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Planilla de IVA (forma 99030)</h1>
        <p className="text-sm text-muted-foreground">Borrador derivado de los Libros de Compras/Ventas (triple igualdad). Base fiscal VES.</p>
      </header>

      <PeriodoSelector anio={anio} mes={mes} onAnio={setAnio} onMes={setMes} />

      {q.isLoading && <p className="text-sm text-muted-foreground">Calculando planilla…</p>}
      {q.isError && <p role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">No se pudo calcular la planilla.</p>}

      {q.data && p && (
        <>
          {(!q.data.cuadre.debitoCuadra || !q.data.cuadre.creditoCuadra) && (
            <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-800">
              La planilla no cuadra con los libros — revisar (no debería ocurrir).
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Renglon etiqueta="Débito fiscal (ventas)" valor={p.debitoFiscal} />
            <Renglon etiqueta="Crédito fiscal del período" valor={p.creditoFiscalDelPeriodo} />
            <Renglon etiqueta="% prorrata aplicado" valor={`${p.porcentajeProrrata} %`} />
            <Renglon etiqueta="Crédito deducible (tras prorrata)" valor={p.creditoFiscalDeducible} />
            <Renglon etiqueta="Crédito no deducible (al costo)" valor={p.creditoFiscalAlCosto} />
            <Renglon etiqueta="Excedente de crédito anterior" valor={p.excedenteCreditoAnterior} />
            <Renglon etiqueta="Cuota tributaria" valor={p.cuotaTributaria} />
            <Renglon etiqueta="Retenciones soportadas (período)" valor={p.retencionesDelPeriodo} />
            <Renglon etiqueta="Excedente de retenciones anterior" valor={p.excedenteRetencionesAnterior} />
            <Renglon etiqueta="Retenciones acumuladas" valor={p.retencionesAcumuladas} />
            <Renglon etiqueta="Cuota a pagar" valor={p.cuotaAPagar} destacado />
            <Renglon etiqueta="Excedente de crédito siguiente" valor={p.excedenteCreditoSiguiente} />
            <Renglon etiqueta="Excedente de retenciones siguiente" valor={p.excedenteRetencionesSiguiente} />
          </div>

          <DebitoCreditoTabla titulo="Débito por alícuota (Libro de Ventas)" grupos={q.data.libroVentas.grupos} />
          <DebitoCreditoTabla titulo="Crédito por alícuota (Libro de Compras)" grupos={q.data.libroCompras.grupos} />

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

function DebitoCreditoTabla({ titulo, grupos }: { titulo: string; grupos: { alicuotaCodigo: string; alicuotaTasa: string; base: string; monto: string }[] }) {
  return (
    <div className="rounded-lg border">
      <p className="border-b px-3 py-2 text-sm font-medium">{titulo}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Alícuota</th>
            <th className="px-3 py-2 font-medium">Base Bs</th>
            <th className="px-3 py-2 font-medium">IVA Bs</th>
          </tr>
        </thead>
        <tbody>
          {grupos.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">Sin movimientos.</td></tr>}
          {grupos.map((g) => (
            <tr key={`${g.alicuotaCodigo}-${g.alicuotaTasa}`} className="border-b last:border-0">
              <td className="px-3 py-2">{g.alicuotaCodigo} ({g.alicuotaTasa}%)</td>
              <td className="px-3 py-2 tabular-nums">{g.base}</td>
              <td className="px-3 py-2 tabular-nums">{g.monto}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

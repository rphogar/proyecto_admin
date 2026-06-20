'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PeriodoSelector, Renglon } from '@/components/impuestos/comunes';
import { impuestosApi, type TipoAnticipo } from '@/lib/impuestos-api';
import { useEmpresaActiva } from '@/lib/empresa-activa';

const ahora = new Date();

/** Anticipos quincenales/semanales de IVA/ISLR de SPE por fracción del mes (doc 06 M7, docs/02 §10). */
export default function AnticiposPage() {
  const { companyId } = useEmpresaActiva();
  const [anio, setAnio] = useState(ahora.getFullYear());
  const [mes, setMes] = useState(ahora.getMonth() + 1);
  const [tipo, setTipo] = useState<TipoAnticipo>('ANTICIPO_IVA');
  const [subperiodo, setSubperiodo] = useState(1);
  const [numero, setNumero] = useState('');
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['impuestos', 'anticipo', companyId, tipo, anio, mes, subperiodo],
    queryFn: () => impuestosApi.anticipo(companyId as string, tipo, anio, mes, subperiodo),
    enabled: companyId !== null,
  });

  const presentar = useMutation({
    mutationFn: () => impuestosApi.presentar({ companyId: companyId as string, tipo, anio, mes, subperiodo, numeroDeclaracion: numero || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['impuestos'] }),
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  const a = q.data?.anticipo;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Anticipos de SPE</h1>
        <p className="text-sm text-muted-foreground">Anticipo sobre los ingresos brutos de la fracción (quincena/semana), a la alícuota de la providencia vigente.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <PeriodoSelector anio={anio} mes={mes} onAnio={setAnio} onMes={setMes} />
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoAnticipo)} className="w-44 rounded-md border px-3 py-1.5">
            <option value="ANTICIPO_IVA">Anticipo de IVA</option>
            <option value="ANTICIPO_ISLR">Anticipo de ISLR</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="text-muted-foreground">Fracción</span>
          <input type="number" min={1} value={subperiodo} onChange={(e) => setSubperiodo(Math.max(1, Number(e.target.value)))} className="w-24 rounded-md border px-3 py-1.5" />
        </label>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Calculando anticipo…</p>}
      {q.isError && <p role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">{(q.error as Error).message}</p>}

      {q.data && a && (
        <>
          {q.data.parametroPorDefecto && (
            <p className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-800">
              Usando porcentaje/cadencia por defecto: no hay parámetro de providencia sembrado para esta empresa.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Renglon etiqueta="Cadencia" valor={q.data.cadencia} />
            <Renglon etiqueta="Ventana de la fracción" valor={`${q.data.ventana.desde} → ${q.data.ventana.hasta}`} />
            <Renglon etiqueta="Ingresos brutos Bs" valor={q.data.ingresosBrutos} />
            <Renglon etiqueta="Alícuota" valor={`${a.porcentaje} %`} />
            <Renglon etiqueta="Anticipo calculado Bs" valor={a.anticipoCalculado} />
            <Renglon etiqueta="Créditos aplicados Bs" valor={a.creditosAplicados} />
            <Renglon etiqueta="Anticipo a pagar Bs" valor={a.anticipoAPagar} destacado />
            <Renglon etiqueta="Excedente de créditos siguiente" valor={a.excedenteCreditosSiguiente} />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-4">
            <p className="text-sm font-medium">Presentar anticipo (fracción {subperiodo})</p>
            <p className="text-xs text-muted-foreground">Al presentar se congela un snapshot inmutable (Providencia 121).</p>
            <div className="flex items-center gap-3">
              <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Nº declaración SENIAT (opcional)" className="flex-1 rounded-md border px-3 py-1.5 text-sm" />
              <button onClick={() => presentar.mutate()} disabled={presentar.isPending} className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-50">
                {presentar.isPending ? 'Presentando…' : 'Marcar como presentada'}
              </button>
            </div>
            {presentar.isError && <p role="alert" className="text-sm text-destructive">{(presentar.error as Error).message}</p>}
            {presentar.isSuccess && <p className="text-sm text-emerald-600">Anticipo presentado.</p>}
          </div>
        </>
      )}
    </div>
  );
}

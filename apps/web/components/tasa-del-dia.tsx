'use client';

import { type EstadoFrescura, fechaFiscal } from '@contave/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { crearTasaManual, fetchTasaDelDia, type TasaDelDiaDto } from '@/lib/api';
import { useEmpresaActiva } from '@/lib/empresa-activa';

/** Mensaje del banner según el rezago de la tasa (caso 57). */
const MENSAJE_FRESCURA: Record<Exclude<EstadoFrescura, 'fresca'>, string> = {
  rezagada: 'La tasa publicada tiene varios días de rezago; el BCV podría no haber actualizado aún.',
  critica:
    'Sin tasa reciente del BCV. Se opera con la última disponible — verifica antes de emitir documentos.',
};

/** Formato venezolano para la tasa (coma decimal), preservando la precisión publicada. */
function formatearTasa(rate: string): string {
  return rate.replace('.', ',');
}

interface VistaProps {
  data: TasaDelDiaDto | undefined;
  isLoading: boolean;
  isError: boolean;
}

/** Presentacional (sin IO): testeable con props. Muestra la tasa y, si aplica, el banner. */
export function TasaDelDiaVista({ data, isLoading, isError }: VistaProps) {
  if (isLoading) {
    return <div className="rounded-lg border p-4 text-sm text-muted-foreground">Cargando tasa…</div>;
  }
  if (isError || data === undefined) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">
        No se pudo obtener la tasa del día.
      </div>
    );
  }

  const banner = data.frescura === 'fresca' ? null : MENSAJE_FRESCURA[data.frescura];

  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4" aria-label="Tasa del día">
      <header className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-muted-foreground">Tasa del día · {data.moneda}/VES</span>
        {data.source !== null && (
          <span className="text-xs uppercase text-muted-foreground">{data.source}</span>
        )}
      </header>

      {data.rate === null ? (
        <p className="text-sm text-muted-foreground">Sin tasa registrada.</p>
      ) : (
        <p className="text-2xl font-semibold tabular-nums">Bs {formatearTasa(data.rate)}</p>
      )}

      {data.rateDate !== null && (
        <p className="text-xs text-muted-foreground">Vigente desde {data.rateDate}</p>
      )}

      {banner !== null && (
        <p
          role="alert"
          className="mt-1 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          {banner}
        </p>
      )}
    </section>
  );
}

/**
 * Carga MANUAL de tasa (fallback del caso 57: el BCV no publicó o el job no corrió). Plegable:
 * solo aparece bajo demanda para no estorbar cuando la tasa automática está fresca. Requiere sesión
 * activa (la API exige contexto de tenant); al guardar, refresca la "tasa del día".
 */
function FormularioTasaManual({ moneda }: { moneda: string }) {
  const queryClient = useQueryClient();
  const { sesion } = useEmpresaActiva();
  const [abierto, setAbierto] = useState(false);
  const [rate, setRate] = useState('');
  const [rateDate, setRateDate] = useState('');
  const [motivo, setMotivo] = useState('');

  // Prefill de la fecha en el cliente (evita desajuste SSR con la fecha de Caracas).
  useEffect(() => {
    setRateDate(fechaFiscal(new Date()));
  }, []);

  const mutacion = useMutation({
    mutationFn: () => crearTasaManual({ moneda, rate, rateDate, motivo }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasa-dia'] });
      setRate('');
      setMotivo('');
      setAbierto(false);
    },
  });

  if (sesion === null) {
    return (
      <p className="text-xs text-muted-foreground">
        Entra a una empresa para cargar una tasa manual.
      </p>
    );
  }

  if (!abierto) {
    return (
      <Button size="sm" variant="outline" onClick={() => setAbierto(true)}>
        Cargar tasa manual
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        mutacion.mutate();
      }}
    >
      <label className="text-xs text-muted-foreground">
        Tasa (Bs por {moneda})
        <Input
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          placeholder="40.50000000"
          required
        />
      </label>
      <label className="text-xs text-muted-foreground">
        Vigente desde
        <Input type="date" value={rateDate} onChange={(e) => setRateDate(e.target.value)} required />
      </label>
      <label className="text-xs text-muted-foreground">
        Motivo (obligatorio, auditado)
        <Input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="BCV no publicó; tasa tomada de…"
          minLength={3}
          required
        />
      </label>
      {mutacion.isError && (
        <p role="alert" className="text-xs text-destructive">
          {mutacion.error instanceof Error ? mutacion.error.message : 'No se pudo guardar la tasa.'}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={mutacion.isPending}>
          {mutacion.isPending ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Contenedor: obtiene la tasa con TanStack Query, delega en la vista y ofrece la carga manual. */
export function TasaDelDia({ moneda = 'USD' }: { moneda?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tasa-dia', moneda],
    queryFn: () => fetchTasaDelDia(moneda),
  });
  return (
    <div className="flex flex-col gap-2">
      <TasaDelDiaVista data={data} isLoading={isLoading} isError={isError} />
      <FormularioTasaManual moneda={moneda} />
    </div>
  );
}

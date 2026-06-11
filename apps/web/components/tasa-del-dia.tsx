'use client';

import type { EstadoFrescura } from '@contave/shared';
import { useQuery } from '@tanstack/react-query';
import { fetchTasaDelDia, type TasaDelDiaDto } from '@/lib/api';

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

/** Contenedor: obtiene la tasa con TanStack Query y delega en la vista. */
export function TasaDelDia({ moneda = 'USD' }: { moneda?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tasa-dia', moneda],
    queryFn: () => fetchTasaDelDia(moneda),
  });
  return <TasaDelDiaVista data={data} isLoading={isLoading} isError={isError} />;
}

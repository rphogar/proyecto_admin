'use client';

/** Componentes compartidos por las pantallas del módulo de Impuestos (doc 06 M7). */

export function PeriodoSelector({ anio, mes, onAnio, onMes }: { anio: number; mes: number; onAnio: (n: number) => void; onMes: (n: number) => void }) {
  return (
    <div className="flex items-end gap-3">
      <label className="flex flex-col text-sm">
        <span className="text-muted-foreground">Año</span>
        <input type="number" value={anio} onChange={(e) => onAnio(Number(e.target.value))} className="w-28 rounded-md border px-3 py-1.5" />
      </label>
      <label className="flex flex-col text-sm">
        <span className="text-muted-foreground">Mes</span>
        <select value={mes} onChange={(e) => onMes(Number(e.target.value))} className="w-28 rounded-md border px-3 py-1.5">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function PresentarBloque({ numero, onNumero, onPresentar, pendiente, error, ok }: {
  numero: string;
  onNumero: (s: string) => void;
  onPresentar: () => void;
  pendiente: boolean;
  error: string | null;
  ok: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-sm font-medium">Presentar declaración</p>
      <p className="text-xs text-muted-foreground">Al presentar se congela un snapshot inmutable (Providencia 121). Una corrección se hace con sustitutiva.</p>
      <div className="flex items-center gap-3">
        <input value={numero} onChange={(e) => onNumero(e.target.value)} placeholder="Nº declaración SENIAT (opcional)" className="flex-1 rounded-md border px-3 py-1.5 text-sm" />
        <button onClick={onPresentar} disabled={pendiente} className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-50">
          {pendiente ? 'Presentando…' : 'Marcar como presentada'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {ok && <p className="text-sm text-emerald-600">Declaración presentada.</p>}
    </div>
  );
}

/** Una fila etiqueta/valor numérico para los renglones de las planillas. */
export function Renglon({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-lg border px-4 py-2 ${destacado ? 'border-foreground/40 bg-accent font-semibold' : ''}`}>
      <span className="text-sm text-muted-foreground">{etiqueta}</span>
      <span className="tabular-nums">{valor}</span>
    </div>
  );
}

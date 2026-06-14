'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { ApiError } from '@/lib/maestros-api';
import { type GrupoConciliacion, type TipoMatch, tesoreriaApi } from '@/lib/tesoreria-api';

function tipoDe(nBanco: number, nSistema: number): TipoMatch | null {
  if (nBanco === 1 && nSistema === 1) return 'UNO_A_UNO';
  if (nBanco === 1 && nSistema >= 1) return 'UNO_A_N';
  if (nBanco >= 1 && nSistema === 1) return 'N_A_UNO';
  return null;
}

/** Conciliación bancaria de dos columnas (doc 06 M4 "feature estrella"): banco ⇄ sistema, n:m. */
export default function ConciliacionPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [selBanco, setSelBanco] = useState<Set<string>>(new Set());
  const [selSistema, setSelSistema] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const bancos = useQuery({
    queryKey: ['tesoreria', 'bancos', companyId],
    queryFn: () => tesoreriaApi.listarBancos(companyId as string),
    enabled: companyId !== null,
  });
  const data = useQuery({
    queryKey: ['tesoreria', 'conciliacion', companyId, bankAccountId],
    queryFn: () => tesoreriaApi.sugerencias(companyId as string, bankAccountId),
    enabled: companyId !== null && bankAccountId !== '',
  });

  const sugeridos = useMemo(() => {
    const b = new Set<string>();
    const s = new Set<string>();
    for (const sug of data.data?.sugerencias ?? []) {
      sug.bancoIds.forEach((id) => b.add(id));
      sug.sistemaIds.forEach((id) => s.add(id));
    }
    return { b, s };
  }, [data.data]);

  const importar = useMutation({
    mutationFn: async (file: File) => {
      const contenido = await file.text();
      return tesoreriaApi.importar({ companyId: companyId as string, bankAccountId, archivoNombre: file.name, contenido });
    },
    onSuccess: (r) => {
      setMsg(r.yaImportado ? 'Ese archivo ya estaba importado (sin duplicar).' : `Importadas ${r.lineasInsertadas} líneas.`);
      void qc.invalidateQueries({ queryKey: ['tesoreria', 'conciliacion'] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'No se pudo importar el estado de cuenta'),
  });

  const conciliar = useMutation({
    mutationFn: (grupos: GrupoConciliacion[]) => tesoreriaApi.conciliar({ companyId: companyId as string, bankAccountId, grupos }),
    onSuccess: (r) => {
      setMsg(`Conciliadas ${r.grupos} partidas (${r.filas} líneas).`);
      setSelBanco(new Set());
      setSelSistema(new Set());
      void qc.invalidateQueries({ queryKey: ['tesoreria', 'conciliacion'] });
    },
    onError: (e) => setMsg(e instanceof ApiError ? e.message : 'No se pudo conciliar'),
  });

  const aceptar = useMutation({
    mutationFn: () => tesoreriaApi.aceptarSugerencias(companyId as string, bankAccountId),
    onSuccess: (r) => {
      setMsg(`Aceptadas ${r.grupos} sugerencias.`);
      void qc.invalidateQueries({ queryKey: ['tesoreria', 'conciliacion'] });
    },
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSet(next);
  };

  const tipoSel = tipoDe(selBanco.size, selSistema.size);
  const nSugerencias = data.data?.sugerencias.length ?? 0;

  const conciliarSeleccion = () => {
    if (tipoSel === null) {
      setMsg('Una conciliación n:m requiere que un lado tenga una sola línea (1:1, 1:n o n:1).');
      return;
    }
    conciliar.mutate([{ tipo: tipoSel, statementLineIds: [...selBanco], journalLineIds: [...selSistema] }]);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conciliación bancaria</h1>
          <p className="text-sm text-muted-foreground">Empareja el extracto del banco con los movimientos del sistema (1:1, 1:n, n:1).</p>
        </div>
        <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="">Selecciona una cuenta bancaria…</option>
          {bancos.data?.map((b) => <option key={b.id} value={b.id}>{b.banco} · {b.nombre} ({b.moneda})</option>)}
        </select>
      </header>

      {bankAccountId !== '' && (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importar.mutate(f);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importar.isPending}>
            {importar.isPending ? 'Importando…' : 'Importar estado de cuenta'}
          </Button>
          <Button onClick={() => aceptar.mutate()} disabled={aceptar.isPending || nSugerencias === 0}>
            Aceptar sugerencias ({nSugerencias})
          </Button>
          <Button onClick={conciliarSeleccion} disabled={conciliar.isPending || selBanco.size + selSistema.size === 0}>
            Conciliar selección{tipoSel ? ` (${tipoSel.replaceAll('_', ' ').toLowerCase()})` : ''}
          </Button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      )}

      {bankAccountId !== '' && (
        <div className="grid grid-cols-2 gap-4">
          <Columna titulo="Banco (extracto)" vacio="Importa un estado de cuenta para ver los movimientos PENDIENTES.">
            {data.data?.banco.map((b) => (
              <Fila key={b.id} seleccion={selBanco.has(b.id)} sugerido={sugeridos.b.has(b.id)} onToggle={() => toggle(selBanco, setSelBanco, b.id)}
                fecha={b.fecha} detalle={b.descripcion ?? b.referencia ?? '—'} monto={b.monto} />
            ))}
          </Columna>
          <Columna titulo="Sistema (libros)" vacio="No hay movimientos sin conciliar en esta cuenta.">
            {data.data?.sistema.map((s) => (
              <Fila key={s.id} seleccion={selSistema.has(s.id)} sugerido={sugeridos.s.has(s.id)} onToggle={() => toggle(selSistema, setSelSistema, s.id)}
                fecha={s.fecha} detalle={s.descripcion} monto={s.monto} />
            ))}
          </Columna>
        </div>
      )}
    </div>
  );
}

function Columna({ titulo, vacio, children }: { titulo: string; vacio: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  return (
    <section className="rounded-lg border">
      <h2 className="border-b px-3 py-2 text-sm font-semibold">{titulo}</h2>
      <ul className="divide-y">
        {arr.filter(Boolean).length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">{vacio}</li> : children}
      </ul>
    </section>
  );
}

function Fila({ seleccion, sugerido, onToggle, fecha, detalle, monto }: { seleccion: boolean; sugerido: boolean; onToggle: () => void; fecha: string; detalle: string; monto: string }) {
  const positivo = !monto.startsWith('-');
  return (
    <li className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50 ${seleccion ? 'bg-accent' : sugerido ? 'bg-amber-50' : ''}`} onClick={onToggle}>
      <input type="checkbox" checked={seleccion} onChange={onToggle} onClick={(e) => e.stopPropagation()} />
      <span className="w-24 shrink-0 text-muted-foreground">{fecha}</span>
      <span className="min-w-0 flex-1 truncate">{detalle}</span>
      <span className={`tabular-nums ${positivo ? 'text-emerald-700' : 'text-red-600'}`}>{monto}</span>
    </li>
  );
}

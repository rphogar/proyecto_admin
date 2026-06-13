'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { fetchTasaDelDia } from '@/lib/api';
import { ApiError, itemsApi, type Item, partiesApi, type Party, seriesApi, type Serie } from '@/lib/maestros-api';
import {
  type AlicuotaCodigo,
  type DocumentoInput,
  documentosApi,
  type Incumplimiento,
  type ResultadoCalculo,
} from '@/lib/ventas-api';
import { ModalCobro } from './modal-cobro';

/** Una línea editable del documento (estado local del editor). */
interface LineaUI {
  itemId: string | null;
  descripcion: string;
  cantidad: string;
  precioUnitarioOrigen: string;
  descuentoOrigen: string;
  alicuotaCodigo: AlicuotaCodigo;
  alicuotaTasa: string;
}

const ALICUOTAS: { codigo: AlicuotaCodigo; tasa: string; etiqueta: string }[] = [
  { codigo: 'GENERAL', tasa: '16', etiqueta: 'General 16%' },
  { codigo: 'REDUCIDA', tasa: '8', etiqueta: 'Reducida 8%' },
  { codigo: 'EXENTO', tasa: '0', etiqueta: 'Exento' },
  { codigo: 'EXPORTACION', tasa: '0', etiqueta: 'Exportación 0%' },
];

const lineaVacia = (): LineaUI => ({
  itemId: null,
  descripcion: '',
  cantidad: '1',
  precioUnitarioOrigen: '0',
  descuentoOrigen: '0',
  alicuotaCodigo: 'GENERAL',
  alicuotaTasa: '16',
});

const TIPO_ETIQUETA: Record<string, string> = {
  FACTURA: 'Factura',
  NOTA_CREDITO: 'Nota de crédito',
  NOTA_DEBITO: 'Nota de débito',
};

interface Props {
  tipo?: 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO';
  affectedDocumentId?: string | undefined;
}

/**
 * Editor de factura/NC/ND (doc 06 M1): cabecera, líneas, panel de totales EN VIVO con IGTF estimado,
 * validador visible y botones Guardar borrador / Emitir / Emitir y cobrar. La UI NUNCA calcula
 * impuestos (regla 3): todo viene de `POST /documentos/calcular`.
 */
export function EditorFactura({ tipo = 'FACTURA', affectedDocumentId }: Props) {
  const { companyId } = useEmpresaActiva();
  const router = useRouter();

  const [seriesId, setSeriesId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [moneda, setMoneda] = useState('VES');
  const [paymentCondition, setPaymentCondition] = useState<'CONTADO' | 'CREDITO'>('CONTADO');
  const [numeroControl, setNumeroControl] = useState('');
  const [lineas, setLineas] = useState<LineaUI[]>([lineaVacia()]);
  const [pagaEnDivisas, setPagaEnDivisas] = useState(false);
  const [calc, setCalc] = useState<ResultadoCalculo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incumplimientos, setIncumplimientos] = useState<Incumplimiento[]>([]);
  const [emitido, setEmitido] = useState<string | null>(null);
  const [cobroAbierto, setCobroAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Maestros para los selectores.
  const parties = useQuery({ queryKey: ['parties', companyId], queryFn: () => partiesApi.listar(companyId as string), enabled: companyId !== null });
  const items = useQuery({ queryKey: ['items', companyId], queryFn: () => itemsApi.listar(companyId as string), enabled: companyId !== null });
  const series = useQuery({ queryKey: ['series', companyId], queryFn: () => seriesApi.listar(companyId as string), enabled: companyId !== null });

  // Tasa BCV del día: del documento (si es divisa) y la gerencial USD (siempre). Visible y bloqueada.
  const tasaDoc = useQuery({ queryKey: ['tasa', moneda], queryFn: () => fetchTasaDelDia(moneda), enabled: moneda !== 'VES' });
  const tasaUsd = useQuery({ queryKey: ['tasa', 'USD'], queryFn: () => fetchTasaDelDia('USD') });

  const rateBcv = moneda === 'VES' ? null : (tasaDoc.data?.rate ?? null);
  const rateUsdMgmt = tasaUsd.data?.rate ?? null;

  const seriesDelTipo = useMemo(() => (series.data ?? []).filter((s: Serie) => s.docType === tipo), [series.data, tipo]);

  // Construye el cuerpo para la API (cálculo, borrador, emisión).
  const construirInput = (): DocumentoInput | null => {
    if (companyId === null || rateUsdMgmt === null) return null;
    return {
      companyId,
      seriesId,
      tipo,
      moneda,
      rateBcv,
      rateUsdMgmt,
      paymentCondition,
      numeroControl: numeroControl || null,
      partyId: partyId || null,
      affectedDocumentId: affectedDocumentId ?? null,
      empresaEsPerceptor: true,
      pagosEstimados: pagaEnDivisas
        ? [{ moneda: moneda === 'VES' ? 'USD' : moneda, montoOrigen: calc?.calculo.totales.totalOrigen ?? '0', esDivisa: true, rateBcv: rateBcv ?? rateUsdMgmt }]
        : [],
      lineas: lineas.map((l) => ({
        itemId: l.itemId,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitarioOrigen: l.precioUnitarioOrigen,
        descuentoOrigen: l.descuentoOrigen,
        alicuotaCodigo: l.alicuotaCodigo,
        alicuotaTasa: l.alicuotaTasa,
      })),
    };
  };

  // Cálculo EN VIVO (debounced) cuando cambian líneas/moneda/tasa/pago.
  useEffect(() => {
    const input = construirInput();
    if (input === null || lineas.every((l) => l.descripcion.trim() === '')) {
      setCalc(null);
      return;
    }
    const t = setTimeout(() => {
      documentosApi
        .calcular(input)
        .then((r) => {
          setCalc(r);
          setIncumplimientos(r.incumplimientos);
          setError(null);
        })
        .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Error al calcular'));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(lineas), moneda, rateBcv, rateUsdMgmt, partyId, seriesId, paymentCondition, numeroControl, pagaEnDivisas]);

  function setLinea(i: number, patch: Partial<LineaUI>) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function aplicarItem(i: number, itemId: string) {
    const it = (items.data ?? []).find((x: Item) => x.id === itemId);
    if (!it) {
      setLinea(i, { itemId: null });
      return;
    }
    const al = ALICUOTAS.find((a) => a.codigo === it.alicuotaIva) ?? ALICUOTAS[0]!;
    setLinea(i, { itemId: it.id, descripcion: it.descripcion, alicuotaCodigo: al.codigo, alicuotaTasa: al.tasa });
  }

  async function guardarBorrador() {
    const input = construirInput();
    if (input === null) return;
    setGuardando(true);
    setError(null);
    try {
      await documentosApi.crearBorrador(input);
      router.push('/ventas/facturas');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al guardar el borrador');
    } finally {
      setGuardando(false);
    }
  }

  async function emitir(luegoCobrar: boolean) {
    const input = construirInput();
    if (input === null) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await documentosApi.emitir(input);
      setEmitido(r.documento.id);
      if (luegoCobrar) {
        setCobroAbierto(true);
      } else {
        router.push('/ventas/facturas');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al emitir');
    } finally {
      setGuardando(false);
    }
  }

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  const puedeEmitir = incumplimientos.length === 0 && calc !== null && seriesId !== '';

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Nueva {TIPO_ETIQUETA[tipo]}</h1>
        <p className="text-sm text-muted-foreground">La pantalla muestra los totales y el validador en vivo; los impuestos los calcula el motor fiscal, no la UI.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {/* Cabecera */}
          <section className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
            <Campo etiqueta="Cliente">
              <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                <option value="">Consumidor final</option>
                {(parties.data ?? []).map((p: Party) => (
                  <option key={p.id} value={p.id}>{p.razonSocial} ({p.rif})</option>
                ))}
              </Select>
            </Campo>
            <Campo etiqueta="Serie">
              <Select value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
                <option value="">— elige serie —</option>
                {seriesDelTipo.map((s: Serie) => (
                  <option key={s.id} value={s.id}>{s.prefijo || s.docType} (próx. {s.nextNumber})</option>
                ))}
              </Select>
            </Campo>
            <Campo etiqueta="Moneda">
              <Select value={moneda} onChange={(e) => setMoneda(e.target.value)}>
                <option value="VES">VES (Bs)</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </Select>
            </Campo>
            <Campo etiqueta="Condición de pago">
              <Select value={paymentCondition} onChange={(e) => setPaymentCondition(e.target.value as 'CONTADO' | 'CREDITO')}>
                <option value="CONTADO">Contado</option>
                <option value="CREDITO">Crédito</option>
              </Select>
            </Campo>
            <Campo etiqueta="Número de control">
              <Input value={numeroControl} onChange={(e) => setNumeroControl(e.target.value)} placeholder="00-00000000" />
            </Campo>
            <Campo etiqueta="Tasa BCV del día (bloqueada)">
              <Input value={moneda === 'VES' ? 'N/A (documento en Bs)' : (rateBcv ?? 'cargando…')} disabled readOnly />
            </Campo>
          </section>

          {/* Líneas */}
          <section className="rounded-lg border p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">Líneas</h2>
              <Button size="sm" variant="outline" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>+ Línea</Button>
            </div>
            <div className="flex flex-col gap-2">
              {lineas.map((l, i) => (
                <div key={i} className="grid grid-cols-12 items-center gap-2 text-sm">
                  <Select className="col-span-3" value={l.itemId ?? ''} onChange={(e) => aplicarItem(i, e.target.value)}>
                    <option value="">Texto libre</option>
                    {(items.data ?? []).map((it: Item) => (
                      <option key={it.id} value={it.id}>{it.sku} — {it.descripcion}</option>
                    ))}
                  </Select>
                  <Input className="col-span-3" placeholder="Descripción" value={l.descripcion} onChange={(e) => setLinea(i, { descripcion: e.target.value })} />
                  <Input className="col-span-1" type="number" value={l.cantidad} onChange={(e) => setLinea(i, { cantidad: e.target.value })} />
                  <Input className="col-span-2" type="number" value={l.precioUnitarioOrigen} onChange={(e) => setLinea(i, { precioUnitarioOrigen: e.target.value })} />
                  <Select
                    className="col-span-2"
                    value={l.alicuotaCodigo}
                    onChange={(e) => {
                      const a = ALICUOTAS.find((x) => x.codigo === (e.target.value as AlicuotaCodigo))!;
                      setLinea(i, { alicuotaCodigo: a.codigo, alicuotaTasa: a.tasa });
                    }}
                  >
                    {ALICUOTAS.map((a) => (
                      <option key={a.codigo} value={a.codigo}>{a.etiqueta}</option>
                    ))}
                  </Select>
                  <button type="button" className="col-span-1 text-destructive" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} aria-label="Quitar línea">✕</button>
                </div>
              ))}
            </div>
          </section>

          {error !== null && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={guardarBorrador} disabled={guardando}>Guardar borrador</Button>
            <Button onClick={() => emitir(false)} disabled={!puedeEmitir || guardando}>Emitir</Button>
            <Button onClick={() => emitir(true)} disabled={!puedeEmitir || guardando}>Emitir y cobrar</Button>
          </div>
        </div>

        {/* Panel de totales EN VIVO + validador */}
        <aside className="flex flex-col gap-4">
          <section className="rounded-lg border p-4 text-sm">
            <h2 className="mb-2 font-medium">Totales</h2>
            {calc === null ? (
              <p className="text-muted-foreground">Agrega líneas para ver los totales.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {calc.calculo.impuestos.map((t) => (
                  <div key={t.alicuotaCodigo} className="flex justify-between">
                    <span className="text-muted-foreground">Base {t.alicuotaCodigo} ({t.alicuotaTasa}%)</span>
                    <span>{t.baseOrigen}</span>
                  </div>
                ))}
                {calc.calculo.impuestos.filter((t) => Number(t.montoOrigen) > 0).map((t) => (
                  <div key={`iva-${t.alicuotaCodigo}`} className="flex justify-between">
                    <span className="text-muted-foreground">IVA {t.alicuotaTasa}%</span>
                    <span>{t.montoOrigen}</span>
                  </div>
                ))}
                <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                  <span>Total ({moneda})</span>
                  <span>{calc.calculo.totales.totalOrigen}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Equivalente Bs</span>
                  <span>{calc.calculo.totales.totalVes}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Equivalente USD</span>
                  <span>{calc.calculo.totales.totalUsdMgmt}</span>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={pagaEnDivisas} onChange={(e) => setPagaEnDivisas(e.target.checked)} />
                  Estimar IGTF si paga en divisas
                </label>
                {pagaEnDivisas && (
                  <div className="flex justify-between text-amber-700">
                    <span>IGTF estimado (Bs)</span>
                    <span>{calc.igtfEstimadoVes ?? '—'}</span>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="rounded-lg border p-4 text-sm">
            <h2 className="mb-2 font-medium">Validador (00071/00102)</h2>
            {incumplimientos.length === 0 ? (
              <p className="text-emerald-700">✓ Listo para emitir.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {incumplimientos.map((inc) => (
                  <li key={inc.codigo} className="text-destructive">• {inc.mensaje} <span className="text-xs text-muted-foreground">({inc.norma})</span></li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {emitido !== null && (
        <ModalCobro
          open={cobroAbierto}
          onClose={() => {
            setCobroAbierto(false);
            router.push('/ventas/facturas');
          }}
          documentId={emitido}
          rateUsdMgmt={rateUsdMgmt ?? '0'}
        />
      )}
    </div>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{etiqueta}</span>
      {children}
    </label>
  );
}

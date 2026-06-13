'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { type CompraInput, type CompraRegistrada, comprasApi } from '@/lib/compras-api';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { ApiError, partiesApi } from '@/lib/maestros-api';
import type { AlicuotaCodigo, LineaBorradorInput } from '@/lib/ventas-api';

const ALICUOTAS: { codigo: AlicuotaCodigo; tasa: string; etiqueta: string }[] = [
  { codigo: 'GENERAL', tasa: '16', etiqueta: 'General 16%' },
  { codigo: 'REDUCIDA', tasa: '8', etiqueta: 'Reducida 8%' },
  { codigo: 'ADICIONAL', tasa: '31', etiqueta: 'Adicional 31%' },
  { codigo: 'EXENTO', tasa: '0', etiqueta: 'Exento' },
];

const lineaVacia: LineaBorradorInput = {
  descripcion: '',
  cantidad: '1',
  precioUnitarioOrigen: '0',
  alicuotaCodigo: 'GENERAL',
  alicuotaTasa: '16',
};

/**
 * Editor de factura de compra (doc 06 M2): número y número de control del proveedor (obligatorios),
 * base/IVA por alícuota, retención de IVA automática (75/100) si la empresa es agente y retención de
 * ISLR por concepto. Registra y muestra los comprobantes de retención emitidos (PDF/TXT).
 */
export function EditorCompra() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [partyId, setPartyId] = useState('');
  const [numeroDocumento, setNumeroDocumento] = useState('');
  const [numeroControl, setNumeroControl] = useState('');
  const [moneda, setMoneda] = useState('VES');
  const [rateBcv, setRateBcv] = useState('');
  const [rateUsdMgmt, setRateUsdMgmt] = useState('');
  const [cuentaDestino, setCuentaDestino] = useState('5.2');
  const [forzar100, setForzar100] = useState(false);
  const [conceptoIslr, setConceptoIslr] = useState('');
  const [tarifaIslr, setTarifaIslr] = useState('');
  const [sustraendoIslr, setSustraendoIslr] = useState('');
  const [lineas, setLineas] = useState<LineaBorradorInput[]>([{ ...lineaVacia }]);
  const [resultado, setResultado] = useState<CompraRegistrada | null>(null);

  const proveedores = useQuery({
    queryKey: ['parties', companyId],
    queryFn: () => partiesApi.listar(companyId as string),
    enabled: companyId !== null,
  });
  const proveedoresLista = (proveedores.data ?? []).filter((p) => p.tipo !== 'cliente');

  const totales = useMemo(() => {
    let base = 0;
    let iva = 0;
    for (const l of lineas) {
      const b = Number(l.cantidad || '0') * Number(l.precioUnitarioOrigen || '0') - Number(l.descuentoOrigen || '0');
      base += b;
      iva += (b * Number(l.alicuotaTasa || '0')) / 100;
    }
    return { base, iva, total: base + iva };
  }, [lineas]);

  const registrar = useMutation({
    mutationFn: (body: CompraInput) => comprasApi.registrar(body),
    onSuccess: (r) => {
      setResultado(r);
      void qc.invalidateQueries({ queryKey: ['compras', companyId] });
    },
  });

  function actualizarLinea(i: number, cambios: Partial<LineaBorradorInput>) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambios } : l)));
  }

  function onSubmit() {
    if (companyId === null) return;
    const body: CompraInput = {
      companyId,
      partyId,
      numeroDocumento,
      numeroControl,
      moneda,
      rateBcv: moneda === 'VES' ? null : rateBcv,
      rateUsdMgmt: rateUsdMgmt || '1',
      cuentaDestino,
      forzarRetencion100: forzar100,
      conceptoIslr: conceptoIslr.trim() === '' ? null : conceptoIslr,
      tarifaIslr: tarifaIslr.trim() === '' ? null : tarifaIslr,
      sustraendoIslr: sustraendoIslr.trim() === '' ? null : sustraendoIslr,
      lineas,
    };
    registrar.mutate(body);
  }

  if (companyId === null) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Selecciona una empresa en la barra superior.
      </p>
    );
  }

  const error = registrar.error instanceof ApiError ? registrar.error.message : registrar.error ? String(registrar.error) : null;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Nueva factura de compra</h1>
        <p className="text-sm text-muted-foreground">
          Número y número de control del proveedor son obligatorios. Si la empresa es agente, la
          retención de IVA se calcula automáticamente.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Proveedor
          <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">Selecciona…</option>
            {proveedoresLista.map((p) => (
              <option key={p.id} value={p.id}>
                {p.razonSocial} ({p.rif})
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Cuenta destino (gasto/compra/inventario)
          <Input value={cuentaDestino} onChange={(e) => setCuentaDestino(e.target.value)} placeholder="5.2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Número de factura del proveedor
          <Input value={numeroDocumento} onChange={(e) => setNumeroDocumento(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Número de control
          <Input value={numeroControl} onChange={(e) => setNumeroControl(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Moneda
          <Select value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="VES">VES</option>
            <option value="USD">USD</option>
          </Select>
        </label>
        {moneda !== 'VES' && (
          <label className="flex flex-col gap-1 text-sm">
            Tasa BCV
            <Input value={rateBcv} onChange={(e) => setRateBcv(e.target.value)} placeholder="Bs por divisa" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Tasa gerencial (Bs/USD)
          <Input value={rateUsdMgmt} onChange={(e) => setRateUsdMgmt(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={forzar100} onChange={(e) => setForzar100(e.target.checked)} />
          Forzar retención 100% (factura no discrimina IVA / sin control)
        </label>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Líneas</h2>
        {lineas.map((l, i) => (
          <div key={i} className="grid grid-cols-12 items-end gap-2">
            <Input className="col-span-4" placeholder="Descripción" value={l.descripcion} onChange={(e) => actualizarLinea(i, { descripcion: e.target.value })} />
            <Input className="col-span-2" placeholder="Cant." value={l.cantidad} onChange={(e) => actualizarLinea(i, { cantidad: e.target.value })} />
            <Input className="col-span-2" placeholder="P. unit." value={l.precioUnitarioOrigen} onChange={(e) => actualizarLinea(i, { precioUnitarioOrigen: e.target.value })} />
            <Select
              className="col-span-3"
              value={l.alicuotaCodigo}
              onChange={(e) => {
                const al = ALICUOTAS.find((a) => a.codigo === e.target.value);
                actualizarLinea(i, { alicuotaCodigo: e.target.value as AlicuotaCodigo, alicuotaTasa: al?.tasa ?? '0' });
              }}
            >
              {ALICUOTAS.map((a) => (
                <option key={a.codigo} value={a.codigo}>{a.etiqueta}</option>
              ))}
            </Select>
            <Button variant="outline" className="col-span-1" type="button" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} disabled={lineas.length === 1}>
              ×
            </Button>
          </div>
        ))}
        <Button variant="outline" type="button" className="self-start" onClick={() => setLineas((ls) => [...ls, { ...lineaVacia }])}>
          + Agregar línea
        </Button>
      </section>

      <section className="grid grid-cols-3 gap-3 rounded-lg border p-3">
        <h2 className="col-span-3 text-sm font-semibold">Retención de ISLR (opcional)</h2>
        <label className="flex flex-col gap-1 text-sm">
          Concepto
          <Input value={conceptoIslr} onChange={(e) => setConceptoIslr(e.target.value)} placeholder="Honorarios profesionales" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tarifa %
          <Input value={tarifaIslr} onChange={(e) => setTarifaIslr(e.target.value)} placeholder="3" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Sustraendo (Bs)
          <Input value={sustraendoIslr} onChange={(e) => setSustraendoIslr(e.target.value)} placeholder="0" />
        </label>
      </section>

      <aside className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <span>Base: <strong>{totales.base.toFixed(2)}</strong></span>
        <span>IVA: <strong>{totales.iva.toFixed(2)}</strong></span>
        <span>Total {moneda}: <strong>{totales.total.toFixed(2)}</strong></span>
      </aside>

      {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <Button type="button" onClick={onSubmit} disabled={registrar.isPending || partyId === ''}>
        {registrar.isPending ? 'Registrando…' : 'Registrar compra y generar retenciones'}
      </Button>

      {resultado && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm">
          <p className="font-semibold text-emerald-800">Compra registrada ({resultado.compra.status})</p>
          {resultado.retenciones.length === 0 && <p className="text-emerald-700">Sin retenciones.</p>}
          {resultado.retenciones.map((r) => (
            <div key={r.id} className="mt-2 flex items-center gap-3">
              <span>
                Retención {r.tipo} <strong>{r.numeroComprobante}</strong> — Bs {r.montoVes} ({r.porcentaje}%)
              </span>
              <a className="text-blue-700 underline" href={comprasApi.comprobantePdfUrl(r.id)} target="_blank" rel="noreferrer">PDF</a>
              {r.tipo === 'IVA' && (
                <a className="text-blue-700 underline" href={comprasApi.comprobanteTxtUrl(r.id)} target="_blank" rel="noreferrer">TXT</a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

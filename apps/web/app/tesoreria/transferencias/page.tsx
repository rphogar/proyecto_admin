'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { ApiError } from '@/lib/maestros-api';
import { tesoreriaApi, type TransferenciaInput } from '@/lib/tesoreria-api';

interface FormState {
  origenCodigo: string;
  origenMoneda: string;
  origenMonto: string;
  origenRateBcv: string;
  destinoCodigo: string;
  destinoMoneda: string;
  destinoMonto: string;
  destinoRateBcv: string;
  rateUsdMgmt: string;
}

const INICIAL: FormState = {
  origenCodigo: '1.1.03',
  origenMoneda: 'VES',
  origenMonto: '',
  origenRateBcv: '',
  destinoCodigo: '1.1.02',
  destinoMoneda: 'USD',
  destinoMonto: '',
  destinoRateBcv: '',
  rateUsdMgmt: '',
};

/** Transferencias internas con conversión y diferencial (doc 06 M4). */
export default function TransferenciasPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(INICIAL);
  const [error, setError] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['tesoreria', 'transferencias', companyId],
    queryFn: () => tesoreriaApi.listarTransferencias(companyId as string),
    enabled: companyId !== null,
  });
  const cuentas = useQuery({
    queryKey: ['tesoreria', 'posicion', companyId],
    queryFn: () => tesoreriaApi.posicion(companyId as string),
    enabled: companyId !== null,
  });

  const crear = useMutation({
    mutationFn: (body: TransferenciaInput) => tesoreriaApi.crearTransferencia(body),
    onSuccess: () => {
      setForm(INICIAL);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['tesoreria'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo registrar la transferencia'),
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  const opciones = cuentas.data?.cuentas ?? [];
  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    crear.mutate({
      companyId,
      descripcion: 'Transferencia interna',
      origen: { cuentaCodigo: form.origenCodigo, moneda: form.origenMoneda, monto: form.origenMonto, rateBcv: form.origenRateBcv || null },
      destino: { cuentaCodigo: form.destinoCodigo, moneda: form.destinoMoneda, monto: form.destinoMonto, rateBcv: form.destinoRateBcv || null },
      rateUsdMgmt: form.rateUsdMgmt,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Transferencias internas</h1>
        <p className="text-sm text-muted-foreground">Mueve dinero entre cuentas propias; la conversión genera el diferencial cambiario automático.</p>
      </header>

      <form onSubmit={submit} className="grid grid-cols-2 gap-4 rounded-lg border p-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">Origen (sale)</legend>
          <SelectCuenta value={form.origenCodigo} onChange={set('origenCodigo')} opciones={opciones} />
          <div className="flex gap-2">
            <Input placeholder="Moneda" value={form.origenMoneda} onChange={(e) => set('origenMoneda')(e.target.value.toUpperCase())} className="w-24" />
            <Input placeholder="Monto" value={form.origenMonto} onChange={(e) => set('origenMonto')(e.target.value)} />
          </div>
          <Input placeholder="Tasa BCV (si no es Bs)" value={form.origenRateBcv} onChange={(e) => set('origenRateBcv')(e.target.value)} />
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold">Destino (entra)</legend>
          <SelectCuenta value={form.destinoCodigo} onChange={set('destinoCodigo')} opciones={opciones} />
          <div className="flex gap-2">
            <Input placeholder="Moneda" value={form.destinoMoneda} onChange={(e) => set('destinoMoneda')(e.target.value.toUpperCase())} className="w-24" />
            <Input placeholder="Monto" value={form.destinoMonto} onChange={(e) => set('destinoMonto')(e.target.value)} />
          </div>
          <Input placeholder="Tasa BCV (si no es Bs)" value={form.destinoRateBcv} onChange={(e) => set('destinoRateBcv')(e.target.value)} />
        </fieldset>

        <div className="col-span-2 flex items-center gap-3">
          <Input placeholder="Tasa gerencial Bs/USD" value={form.rateUsdMgmt} onChange={(e) => set('rateUsdMgmt')(e.target.value)} className="w-56" />
          <Button type="submit" disabled={crear.isPending}>{crear.isPending ? 'Registrando…' : 'Registrar transferencia'}</Button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Fecha</th>
              <th className="px-3 py-2 font-medium">Origen</th>
              <th className="px-3 py-2 font-medium">Destino</th>
              <th className="px-3 py-2 text-right font-medium">Diferencial Bs</th>
              <th className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {lista.isLoading && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Cargando…</td></tr>}
            {lista.data?.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sin transferencias todavía.</td></tr>}
            {lista.data?.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <td className="px-3 py-2">{t.fechaFiscal}</td>
                <td className="px-3 py-2">{t.montoOrigen} {t.monedaOrigen}</td>
                <td className="px-3 py-2">{t.montoDestino} {t.monedaDestino}</td>
                <td className="px-3 py-2 text-right tabular-nums">{t.diferencialVes ?? '—'}</td>
                <td className="px-3 py-2 text-emerald-700">{t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SelectCuenta({ value, onChange, opciones }: { value: string; onChange: (v: string) => void; opciones: { codigo: string; nombre: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
      {opciones.length === 0 && <option value={value}>{value}</option>}
      {opciones.map((o) => (
        <option key={o.codigo} value={o.codigo}>{o.codigo} · {o.nombre}</option>
      ))}
    </select>
  );
}

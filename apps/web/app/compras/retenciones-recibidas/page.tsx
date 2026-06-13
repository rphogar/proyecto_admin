'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { comprasApi, type RetencionRecibidaInput } from '@/lib/compras-api';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { ApiError, partiesApi } from '@/lib/maestros-api';

interface RetencionRecibidaFila {
  id: string;
  tipo: string;
  numeroComprobante: string;
  agenteNombre: string;
  montoVes: string;
  periodoAnio: number;
  periodoMes: number;
}

/**
 * Comprobantes de retención RECIBIDOS (doc 06 M2/M3, caso 28): registro con imputación por período
 * de recepción y listado. El crédito pasa a 1.3.02 (IVA) / 1.3.03 (ISLR) y salda la CxC del cliente.
 */
export default function RetencionesRecibidasPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [partyId, setPartyId] = useState('');
  const [tipo, setTipo] = useState<'IVA' | 'ISLR'>('IVA');
  const [numeroComprobante, setNumeroComprobante] = useState('');
  const [baseOrigen, setBaseOrigen] = useState('');
  const [porcentaje, setPorcentaje] = useState('75');
  const [montoOrigen, setMontoOrigen] = useState('');
  const [fechaComprobante, setFechaComprobante] = useState('');
  const [fechaRecepcion, setFechaRecepcion] = useState('');

  const clientes = useQuery({
    queryKey: ['parties', companyId],
    queryFn: () => partiesApi.listar(companyId as string),
    enabled: companyId !== null,
  });
  const lista = useQuery({
    queryKey: ['retenciones-recibidas', companyId],
    queryFn: () => comprasApi.listarRecibidas(companyId as string) as Promise<RetencionRecibidaFila[]>,
    enabled: companyId !== null,
  });

  const registrar = useMutation({
    mutationFn: (body: RetencionRecibidaInput) => comprasApi.registrarRecibida(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['retenciones-recibidas', companyId] });
      setNumeroComprobante('');
      setBaseOrigen('');
      setMontoOrigen('');
    },
  });

  if (companyId === null) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Selecciona una empresa en la barra superior.
      </p>
    );
  }

  const error = registrar.error instanceof ApiError ? registrar.error.message : registrar.error ? String(registrar.error) : null;

  function onSubmit() {
    if (companyId === null) return;
    registrar.mutate({
      companyId,
      partyId,
      tipo,
      numeroComprobante,
      moneda: 'VES',
      rateBcv: null,
      rateUsdMgmt: '1',
      baseOrigen: baseOrigen || '0',
      porcentaje,
      montoOrigen: montoOrigen || '0',
      fechaComprobante: fechaComprobante || undefined,
      fechaRecepcion: fechaRecepcion || undefined,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Comprobantes de retención recibidos</h1>
        <p className="text-sm text-muted-foreground">
          Se imputan en el período de recepción (caso 28) y descuentan de la cuota del tributo.
        </p>
      </header>

      <section className="grid grid-cols-3 gap-3 rounded-lg border p-3">
        <label className="flex flex-col gap-1 text-sm">
          Cliente (agente)
          <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">Selecciona…</option>
            {(clientes.data ?? []).filter((p) => p.tipo !== 'proveedor').map((p) => (
              <option key={p.id} value={p.id}>{p.razonSocial} ({p.rif})</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tipo
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as 'IVA' | 'ISLR')}>
            <option value="IVA">IVA</option>
            <option value="ISLR">ISLR</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Nº comprobante
          <Input value={numeroComprobante} onChange={(e) => setNumeroComprobante(e.target.value)} placeholder="20260600000001" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Base (Bs)
          <Input value={baseOrigen} onChange={(e) => setBaseOrigen(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Porcentaje %
          <Input value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Monto retenido (Bs)
          <Input value={montoOrigen} onChange={(e) => setMontoOrigen(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Fecha del comprobante
          <Input type="date" value={fechaComprobante} onChange={(e) => setFechaComprobante(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Fecha de recepción
          <Input type="date" value={fechaRecepcion} onChange={(e) => setFechaRecepcion(e.target.value)} />
        </label>
        <div className="flex items-end">
          <Button type="button" onClick={onSubmit} disabled={registrar.isPending || partyId === '' || numeroComprobante === ''}>
            {registrar.isPending ? 'Registrando…' : 'Registrar comprobante'}
          </Button>
        </div>
      </section>

      {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Período</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Comprobante</th>
              <th className="px-3 py-2 font-medium">Agente</th>
              <th className="px-3 py-2 font-medium">Monto Bs</th>
            </tr>
          </thead>
          <tbody>
            {lista.data?.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Sin comprobantes todavía.</td></tr>
            )}
            {lista.data?.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="px-3 py-2">{r.periodoAnio}-{String(r.periodoMes).padStart(2, '0')}</td>
                <td className="px-3 py-2">{r.tipo}</td>
                <td className="px-3 py-2">{r.numeroComprobante}</td>
                <td className="px-3 py-2">{r.agenteNombre}</td>
                <td className="px-3 py-2">{r.montoVes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

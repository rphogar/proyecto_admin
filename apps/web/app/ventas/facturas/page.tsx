'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { ApiError } from '@/lib/maestros-api';
import { type Documento, documentosApi } from '@/lib/ventas-api';
import { ModalCobro } from '@/components/ventas/modal-cobro';

const ESTADO_COLOR: Record<string, string> = {
  DRAFT: 'text-amber-700',
  ISSUED: 'text-emerald-700',
  CANCELLED: 'text-muted-foreground',
  APPLIED: 'text-blue-700',
};

/** Listado de documentos de venta con acciones (PDF, NC, cobrar, emitir/editar borrador). */
export default function FacturasPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [cobrar, setCobrar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['documentos', companyId],
    queryFn: () => documentosApi.listar(companyId as string),
    enabled: companyId !== null,
  });

  const emitir = useMutation({
    mutationFn: (id: string) => documentosApi.emitirBorrador(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documentos', companyId] }),
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : 'Error al emitir'),
  });
  const eliminar = useMutation({
    mutationFn: (id: string) => documentosApi.eliminar(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documentos', companyId] }),
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Facturas y notas</h1>
          <p className="text-sm text-muted-foreground">Documentos de venta de la empresa.</p>
        </div>
        <Link href="/ventas/facturas/nueva"><Button>+ Nueva factura</Button></Link>
      </header>

      {error !== null && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Nº</th>
              <th className="px-3 py-2 font-medium">Fecha</th>
              <th className="px-3 py-2 font-medium">Cliente</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Cargando…</td></tr>}
            {lista.data?.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Sin documentos. Crea la primera factura.</td></tr>}
            {lista.data?.map((d: Documento) => (
              <tr key={d.id} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-3 py-2">{d.type}</td>
                <td className="px-3 py-2">{d.number ?? '—'}</td>
                <td className="px-3 py-2">{d.issueFechaFiscal}</td>
                <td className="px-3 py-2">{d.partyNombre ?? 'Consumidor final'}</td>
                <td className="px-3 py-2">{d.totalOrigen} {d.currency}</td>
                <td className={`px-3 py-2 ${ESTADO_COLOR[d.status] ?? ''}`}>{d.status}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    {d.status === 'DRAFT' ? (
                      <>
                        <Button size="sm" onClick={() => emitir.mutate(d.id)} disabled={emitir.isPending}>Emitir</Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm('¿Eliminar el borrador?')) eliminar.mutate(d.id); }}>Eliminar</Button>
                      </>
                    ) : (
                      <>
                        <a href={documentosApi.pdfUrl(d.id)} target="_blank" rel="noreferrer"><Button size="sm" variant="outline">PDF</Button></a>
                        {d.type === 'FACTURA' && <Button size="sm" variant="outline" onClick={() => setCobrar(d.id)}>Cobrar</Button>}
                        {d.type === 'FACTURA' && (
                          <Link href={`/ventas/facturas/nueva?nota=credito&afecta=${d.id}`}><Button size="sm" variant="ghost">NC</Button></Link>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cobrar !== null && (
        <ModalCobro open onClose={() => setCobrar(null)} documentId={cobrar} rateUsdMgmt={lista.data?.find((d) => d.id === cobrar)?.rateUsdMgmt ?? '0'} />
      )}
    </div>
  );
}

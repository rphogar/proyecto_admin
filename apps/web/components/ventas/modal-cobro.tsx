'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { ApiError, type PaymentMethod, paymentMethodsApi } from '@/lib/maestros-api';
import { cobrosApi, documentosApi } from '@/lib/ventas-api';

interface MedioUI {
  paymentMethodId: string;
  montoOrigen: string;
  rateBcv: string;
}

/**
 * Modal de registro de cobro (doc 06 M3): split multimoneda (varios métodos), vuelto y registro.
 * El IGTF y el diferencial cambiario los calcula el backend (regla 3); aquí solo se capturan los
 * pagos y se muestra el vuelto sugerido (aritmética de tendido − total, informativa).
 */
export function ModalCobro({
  open,
  onClose,
  documentId,
  rateUsdMgmt,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  rateUsdMgmt: string;
}) {
  const { companyId } = useEmpresaActiva();
  const [medios, setMedios] = useState<MedioUI[]>([{ paymentMethodId: '', montoOrigen: '0', rateBcv: rateUsdMgmt }]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const metodos = useQuery({ queryKey: ['payment-methods', companyId], queryFn: () => paymentMethodsApi.listar(companyId as string), enabled: companyId !== null && open });
  const doc = useQuery({ queryKey: ['doc', documentId], queryFn: () => documentosApi.obtener(documentId), enabled: open });

  const totalVes = Number(doc.data?.documento.totalVes ?? '0');
  const tenderVes = medios.reduce((s, m) => {
    const met = (metodos.data ?? []).find((x) => x.id === m.paymentMethodId);
    const monto = Number(m.montoOrigen || '0');
    const ves = met?.moneda === 'VES' ? monto : monto * Number(m.rateBcv || '0');
    return s + ves;
  }, 0);
  const vueltoVes = Math.max(0, tenderVes - totalVes);

  function setMedio(i: number, patch: Partial<MedioUI>) {
    setMedios((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  }

  async function registrar() {
    if (companyId === null) return;
    setGuardando(true);
    setError(null);
    try {
      await cobrosApi.registrar({
        companyId,
        documentId,
        rateUsdMgmt,
        medios: medios.map((m) => {
          const met = (metodos.data ?? []).find((x) => x.id === m.paymentMethodId);
          return { paymentMethodId: m.paymentMethodId, montoOrigen: m.montoOrigen, rateBcv: met?.moneda === 'VES' ? null : m.rateBcv };
        }),
      });
      setOk(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al registrar el cobro');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Registrar cobro">
      {ok ? (
        <div className="flex flex-col gap-3">
          <p className="text-emerald-700">✓ Cobro registrado. El asiento (IGTF y diferencial) se generó automáticamente.</p>
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            Factura {doc.data?.documento.number ?? ''} — Total Bs {totalVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
          </p>

          <div className="flex flex-col gap-2">
            {medios.map((m, i) => {
              const met = (metodos.data ?? []).find((x) => x.id === m.paymentMethodId);
              return (
                <div key={i} className="grid grid-cols-12 items-center gap-2">
                  <Select className="col-span-5" value={m.paymentMethodId} onChange={(e) => setMedio(i, { paymentMethodId: e.target.value })}>
                    <option value="">— método —</option>
                    {(metodos.data ?? []).map((pm: PaymentMethod) => (
                      <option key={pm.id} value={pm.id}>{pm.nombre} ({pm.moneda})</option>
                    ))}
                  </Select>
                  <Input className="col-span-3" type="number" placeholder="Monto" value={m.montoOrigen} onChange={(e) => setMedio(i, { montoOrigen: e.target.value })} />
                  <Input className="col-span-3" type="number" placeholder="Tasa BCV" value={m.rateBcv} disabled={met?.moneda === 'VES'} onChange={(e) => setMedio(i, { rateBcv: e.target.value })} />
                  <button type="button" className="col-span-1 text-destructive" onClick={() => setMedios((ms) => ms.filter((_, j) => j !== i))} aria-label="Quitar">✕</button>
                </div>
              );
            })}
            <Button size="sm" variant="outline" onClick={() => setMedios((ms) => [...ms, { paymentMethodId: '', montoOrigen: '0', rateBcv: rateUsdMgmt }])}>
              + Método
            </Button>
          </div>

          <div className="flex justify-between border-t pt-2">
            <span className="text-muted-foreground">Tendido (Bs)</span>
            <span>{tenderVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vuelto sugerido (Bs)</span>
            <span>{vueltoVes.toLocaleString('es-VE', { minimumFractionDigits: 2 })} (≈ ${(vueltoVes / Number(rateUsdMgmt || '1')).toFixed(2)})</span>
          </div>

          {error !== null && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button onClick={registrar} disabled={guardando}>Registrar cobro</Button>
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

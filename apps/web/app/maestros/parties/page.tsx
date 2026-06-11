'use client';

import { validarRif } from '@contave/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { RifFeedback } from '@/components/maestros/rif-feedback';
import { SinEmpresa } from '@/components/maestros/recurso-crud';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { ApiError, type Party, partiesApi } from '@/lib/maestros-api';

const TIPOS = [
  { valor: 'cliente', etiqueta: 'Cliente' },
  { valor: 'proveedor', etiqueta: 'Proveedor' },
  { valor: 'ambos', etiqueta: 'Ambos' },
];
const CONDICIONES = [
  { valor: 'ordinario', etiqueta: 'Ordinario' },
  { valor: 'formal', etiqueta: 'Formal' },
  { valor: 'especial', etiqueta: 'Especial (SPE)' },
  { valor: 'no_contribuyente', etiqueta: 'No contribuyente / consumidor final' },
];

interface Borrador {
  tipo: string;
  rif: string;
  razonSocial: string;
  condicionIva: string;
  esAgenteRetencionIva: boolean;
  pctRetencionIva: string;
  esAgenteRetencionIslr: boolean;
  email: string;
  telefono: string;
  direccionFiscal: string;
  limiteCredito: string;
  diasCredito: string;
  activo: boolean;
  forzarRif: boolean;
}

const VACIO: Borrador = {
  tipo: 'cliente',
  rif: '',
  razonSocial: '',
  condicionIva: 'ordinario',
  esAgenteRetencionIva: false,
  pctRetencionIva: '75',
  esAgenteRetencionIslr: false,
  email: '',
  telefono: '',
  direccionFiscal: '',
  limiteCredito: '',
  diasCredito: '0',
  activo: true,
  forzarRif: false,
};

export default function PartiesPage() {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [b, setB] = useState<Borrador>(VACIO);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rifRes = useMemo(() => (b.rif.trim() === '' ? null : validarRif(b.rif)), [b.rif]);

  const lista = useQuery({
    queryKey: ['parties', companyId],
    queryFn: () => partiesApi.listar(companyId as string),
    enabled: companyId !== null,
  });

  function reset() {
    setB(VACIO);
    setEditId(null);
    setError(null);
  }

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo: Record<string, unknown> = {
        tipo: b.tipo,
        razonSocial: b.razonSocial,
        condicionIva: b.condicionIva,
        esAgenteRetencionIva: b.esAgenteRetencionIva,
        pctRetencionIva: b.esAgenteRetencionIva ? b.pctRetencionIva : null,
        esAgenteRetencionIslr: b.esAgenteRetencionIslr,
        email: b.email,
        telefono: b.telefono,
        direccionFiscal: b.direccionFiscal,
        limiteCredito: b.limiteCredito,
        diasCredito: b.diasCredito,
        activo: b.activo,
      };
      if (editId === null) {
        return partiesApi.crear({ companyId, rif: b.rif, forzarRif: b.forzarRif, ...cuerpo });
      }
      return partiesApi.actualizar(editId, cuerpo);
    },
    onSuccess: () => {
      reset();
      void qc.invalidateQueries({ queryKey: ['parties', companyId] });
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : 'Error al guardar'),
  });

  const borrar = useMutation({
    mutationFn: (id: string) => partiesApi.eliminar(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['parties', companyId] }),
  });

  function editar(p: Party) {
    setEditId(p.id);
    setError(null);
    setB({
      tipo: p.tipo,
      rif: p.rif,
      razonSocial: p.razonSocial,
      condicionIva: p.condicionIva,
      esAgenteRetencionIva: p.esAgenteRetencionIva,
      pctRetencionIva: p.pctRetencionIva ?? '75',
      esAgenteRetencionIslr: p.esAgenteRetencionIslr,
      email: p.email ?? '',
      telefono: p.telefono ?? '',
      direccionFiscal: p.direccionFiscal ?? '',
      limiteCredito: p.limiteCredito ?? '',
      diasCredito: String(p.diasCredito),
      activo: p.activo,
      forzarRif: false,
    });
  }

  if (companyId === null) {
    return <SinEmpresa />;
  }

  const rifInvalido = rifRes !== null && !rifRes.valido;
  const bloquearAlta = editId === null && rifInvalido && !b.forzarRif;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Terceros</h1>
        <p className="text-sm text-muted-foreground">
          Clientes y proveedores con validación de RIF y condición tributaria (docs/05 §3.2).
        </p>
      </header>

      <form
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          guardar.mutate();
        }}
      >
        <p className="col-span-full text-sm font-medium">
          {editId === null ? 'Nuevo tercero' : 'Editar tercero'}
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Tipo</span>
          <Select value={b.tipo} onChange={(e) => setB({ ...b, tipo: e.target.value })}>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">RIF</span>
          <Input
            value={b.rif}
            placeholder="J-12345678-9"
            required
            disabled={editId !== null}
            aria-invalid={rifInvalido}
            onChange={(e) => setB({ ...b, rif: e.target.value })}
          />
          <RifFeedback resultado={editId === null ? rifRes : null} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Razón social</span>
          <Input
            value={b.razonSocial}
            required
            onChange={(e) => setB({ ...b, razonSocial: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Condición IVA</span>
          <Select value={b.condicionIva} onChange={(e) => setB({ ...b, condicionIva: e.target.value })}>
            {CONDICIONES.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.etiqueta}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={b.esAgenteRetencionIva}
            onChange={(e) => setB({ ...b, esAgenteRetencionIva: e.target.checked })}
          />
          <span>Nos retiene IVA (agente)</span>
        </label>

        {b.esAgenteRetencionIva && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">% retención IVA</span>
            <Select
              value={b.pctRetencionIva}
              onChange={(e) => setB({ ...b, pctRetencionIva: e.target.value })}
            >
              <option value="75">75%</option>
              <option value="100">100%</option>
            </Select>
          </label>
        )}

        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={b.esAgenteRetencionIslr}
            onChange={(e) => setB({ ...b, esAgenteRetencionIslr: e.target.checked })}
          />
          <span>Agente de retención ISLR</span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Email</span>
          <Input value={b.email} type="email" onChange={(e) => setB({ ...b, email: e.target.value })} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Teléfono</span>
          <Input value={b.telefono} onChange={(e) => setB({ ...b, telefono: e.target.value })} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Días de crédito</span>
          <Input
            type="number"
            min={0}
            value={b.diasCredito}
            onChange={(e) => setB({ ...b, diasCredito: e.target.value })}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Límite de crédito</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={b.limiteCredito}
            onChange={(e) => setB({ ...b, limiteCredito: e.target.value })}
          />
        </label>

        <label className="col-span-full flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Dirección fiscal</span>
          <Input
            value={b.direccionFiscal}
            onChange={(e) => setB({ ...b, direccionFiscal: e.target.value })}
          />
        </label>

        {/* caso 16: forzar el alta con RIF inválido (requerirá permiso; deja marca de auditoría). */}
        {editId === null && rifInvalido && (
          <label className="col-span-full flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <input
              type="checkbox"
              className="size-4"
              checked={b.forzarRif}
              onChange={(e) => setB({ ...b, forzarRif: e.target.checked })}
            />
            <span>Forzar el alta pese al RIF inválido (queda registrado en auditoría)</span>
          </label>
        )}

        {error !== null && (
          <p role="alert" className="col-span-full rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="col-span-full flex gap-2">
          <Button type="submit" disabled={guardar.isPending || bloquearAlta}>
            {editId === null ? 'Crear' : 'Guardar cambios'}
          </Button>
          {editId !== null && (
            <Button type="button" variant="outline" onClick={reset}>
              Cancelar
            </Button>
          )}
        </div>
      </form>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">RIF</th>
              <th className="px-3 py-2 font-medium">Razón social</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Condición</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.isLoading && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            )}
            {lista.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Sin terceros todavía. Crea el primero con el formulario de arriba.
                </td>
              </tr>
            )}
            {lista.data?.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-accent/40">
                <td className="px-3 py-2 font-mono text-xs">{p.rif}</td>
                <td className="px-3 py-2">{p.razonSocial}</td>
                <td className="px-3 py-2 capitalize">{p.tipo}</td>
                <td className="px-3 py-2">{p.condicionIva}</td>
                <td className="px-3 py-2">{p.activo ? 'Activo' : 'Inactivo'}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => editar(p)}>
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => {
                        if (window.confirm('¿Eliminar este tercero? Esta acción no se puede deshacer.')) {
                          borrar.mutate(p.id);
                        }
                      }}
                    >
                      Eliminar
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

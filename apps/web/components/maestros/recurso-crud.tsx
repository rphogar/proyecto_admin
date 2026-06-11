'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/maestros-api';
import { useEmpresaActiva } from '@/lib/empresa-activa';

/** Tipo de campo del formulario genérico. */
export interface CampoDef<T> {
  nombre: keyof T & string;
  etiqueta: string;
  tipo: 'text' | 'number' | 'select' | 'checkbox';
  opciones?: { valor: string; etiqueta: string }[];
  requerido?: boolean;
  /** Solo editable en el alta (clave de negocio: sku, codigo, doc_type…). */
  soloAlta?: boolean;
  placeholder?: string;
  ayuda?: string;
  /** Valor por defecto en el alta (p.ej. `activo` arranca en true). */
  valorInicial?: string | boolean;
}

export interface ColumnaDef<T> {
  nombre: keyof T & string;
  etiqueta: string;
  render?: (fila: T) => ReactNode;
}

interface ClienteRecurso<T> {
  listar: (companyId: string) => Promise<T[]>;
  crear: (body: Record<string, unknown>) => Promise<T>;
  actualizar: (id: string, body: Record<string, unknown>) => Promise<T>;
  eliminar: (id: string) => Promise<void>;
}

interface Props<T extends { id: string; activo?: boolean }> {
  titulo: string;
  descripcion: string;
  recursoKey: string;
  cliente: ClienteRecurso<T>;
  campos: CampoDef<T>[];
  columnas: ColumnaDef<T>[];
}

type Borrador = Record<string, string | boolean>;

function borradorInicial<T>(campos: CampoDef<T>[]): Borrador {
  const b: Borrador = {};
  for (const c of campos) {
    if (c.valorInicial !== undefined) {
      b[c.nombre] = c.valorInicial;
    } else {
      b[c.nombre] = c.tipo === 'checkbox' ? false : (c.opciones?.[0]?.valor ?? '');
    }
  }
  return b;
}

function aBorrador<T>(fila: Record<string, unknown>, campos: CampoDef<T>[]): Borrador {
  const b: Borrador = {};
  for (const c of campos) {
    const v = fila[c.nombre];
    b[c.nombre] = c.tipo === 'checkbox' ? Boolean(v) : v === null || v === undefined ? '' : String(v);
  }
  return b;
}

/**
 * CRUD genérico de un maestro (P5) siguiendo las convenciones del doc 06: tabla + formulario de
 * alta/edición, confirmación en el borrado, estados vacíos con guía, errores de la API visibles.
 * El selector de empresa de la barra define el `companyId`; sin empresa activa, guía a elegirla.
 */
export function RecursoCrud<T extends { id: string; activo?: boolean }>({
  titulo,
  descripcion,
  recursoKey,
  cliente,
  campos,
  columnas,
}: Props<T>) {
  const { companyId } = useEmpresaActiva();
  const qc = useQueryClient();
  const [editId, setEditId] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador>(() => borradorInicial(campos));
  const [error, setError] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: [recursoKey, companyId],
    queryFn: () => cliente.listar(companyId as string),
    enabled: companyId !== null,
  });

  function invalidar() {
    void qc.invalidateQueries({ queryKey: [recursoKey, companyId] });
  }
  function reset() {
    setEditId(null);
    setBorrador(borradorInicial(campos));
    setError(null);
  }

  const guardar = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { companyId };
      for (const c of campos) {
        if (editId !== null && c.soloAlta) continue;
        body[c.nombre] = borrador[c.nombre];
      }
      return editId === null ? cliente.crear(body) : cliente.actualizar(editId, body);
    },
    onSuccess: () => {
      reset();
      invalidar();
    },
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : 'Error al guardar'),
  });

  const borrar = useMutation({
    mutationFn: (id: string) => cliente.eliminar(id),
    onSuccess: invalidar,
    onError: (e: unknown) => setError(e instanceof ApiError ? e.message : 'Error al eliminar'),
  });

  function editar(fila: T) {
    setEditId(fila.id);
    setBorrador(aBorrador(fila as Record<string, unknown>, campos));
    setError(null);
  }

  if (companyId === null) {
    return <SinEmpresa />;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        <p className="text-sm text-muted-foreground">{descripcion}</p>
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
          {editId === null ? 'Nuevo registro' : 'Editar registro'}
        </p>
        {campos.map((c) => {
          const deshabilitado = editId !== null && c.soloAlta === true;
          return (
            <label key={c.nombre} className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{c.etiqueta}</span>
              {c.tipo === 'select' ? (
                <Select
                  value={String(borrador[c.nombre] ?? '')}
                  disabled={deshabilitado}
                  onChange={(e) => setBorrador((b) => ({ ...b, [c.nombre]: e.target.value }))}
                >
                  {c.opciones?.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.etiqueta}
                    </option>
                  ))}
                </Select>
              ) : c.tipo === 'checkbox' ? (
                <input
                  type="checkbox"
                  className="size-4"
                  checked={Boolean(borrador[c.nombre])}
                  disabled={deshabilitado}
                  onChange={(e) => setBorrador((b) => ({ ...b, [c.nombre]: e.target.checked }))}
                />
              ) : (
                <Input
                  type={c.tipo}
                  value={String(borrador[c.nombre] ?? '')}
                  placeholder={c.placeholder}
                  required={c.requerido}
                  disabled={deshabilitado}
                  onChange={(e) => setBorrador((b) => ({ ...b, [c.nombre]: e.target.value }))}
                />
              )}
              {c.ayuda !== undefined && <span className="text-xs text-muted-foreground">{c.ayuda}</span>}
            </label>
          );
        })}

        {error !== null && (
          <p role="alert" className="col-span-full rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="col-span-full flex gap-2">
          <Button type="submit" disabled={guardar.isPending}>
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
              {columnas.map((col) => (
                <th key={col.nombre} className="px-3 py-2 font-medium">
                  {col.etiqueta}
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.isLoading && (
              <tr>
                <td colSpan={columnas.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                  Cargando…
                </td>
              </tr>
            )}
            {lista.isError && (
              <tr>
                <td colSpan={columnas.length + 1} className="px-3 py-6 text-center text-destructive">
                  No se pudo cargar el listado.
                </td>
              </tr>
            )}
            {lista.data?.length === 0 && (
              <tr>
                <td colSpan={columnas.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                  Sin registros todavía. Crea el primero con el formulario de arriba.
                </td>
              </tr>
            )}
            {lista.data?.map((fila) => (
              <tr key={fila.id} className="border-b last:border-0 hover:bg-accent/40">
                {columnas.map((col) => (
                  <td key={col.nombre} className="px-3 py-2">
                    {col.render ? col.render(fila) : String(fila[col.nombre] ?? '')}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => editar(fila)}>
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => {
                        if (window.confirm(`¿Eliminar este registro? Esta acción no se puede deshacer.`)) {
                          borrar.mutate(fila.id);
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

/** Estado guía cuando no hay empresa activa (doc 06: estados vacíos con guía). */
export function SinEmpresa() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      Selecciona una empresa en la barra superior para gestionar sus maestros.
    </div>
  );
}

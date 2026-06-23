'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import { ApiError } from '@/lib/maestros-api';
import {
  type Invitacion,
  type Miembro,
  ROLES_ASIGNABLES,
  usuariosApi,
} from '@/lib/usuarios-api';

/** Rol del usuario en el tenant activo (sale del selector de empresas de la sesión). */
function useRolActivo(): string | null {
  const { sesion } = useEmpresaActiva();
  if (sesion === null) return null;
  return sesion.empresas.find((e) => e.tenantId === sesion.tenantActivo)?.rol ?? null;
}

function mensajeError(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Ocurrió un error';
}

/**
 * Usuarios, roles e invitaciones (P29, docs/06 M12). Lista los miembros del tenant, permite invitar
 * por email con un rol, reasignar rol, dar de baja/reactivar, transferir la propiedad (solo owner) y
 * configurar la separación de deberes. Incluye el visor de permisos por rol. Las acciones de gestión
 * se ocultan a quien solo tiene lectura; el backend igual las exige (RBAC + invariantes).
 */
export default function UsuariosPage() {
  const qc = useQueryClient();
  const rol = useRolActivo();
  const puedeGestionar = rol === 'owner' || rol === 'admin';
  const esOwner = rol === 'owner';

  const miembros = useQuery({ queryKey: ['usuarios', 'miembros'], queryFn: usuariosApi.listar });
  const invitaciones = useQuery({
    queryKey: ['usuarios', 'invitaciones'],
    queryFn: usuariosApi.invitaciones,
  });
  const catalogo = useQuery({ queryKey: ['usuarios', 'roles'], queryFn: usuariosApi.roles });
  const segregacion = useQuery({
    queryKey: ['usuarios', 'segregacion'],
    queryFn: usuariosApi.segregacion,
  });

  const invalidar = (clave: string) =>
    qc.invalidateQueries({ queryKey: ['usuarios', clave] });

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Usuarios y roles</h1>
        <p className="text-sm text-muted-foreground">
          Gestión de accesos de la empresa: invitaciones, roles, baja/reactivación y separación de
          deberes (docs/06 M12).
        </p>
      </header>

      {puedeGestionar && (
        <Invitar onInvitado={() => void Promise.all([invalidar('invitaciones')])} />
      )}

      <MiembrosTabla
        miembros={miembros.data ?? []}
        cargando={miembros.isLoading}
        puedeGestionar={puedeGestionar}
        esOwner={esOwner}
        onCambio={() => void invalidar('miembros')}
      />

      {puedeGestionar && (
        <InvitacionesPendientes
          invitaciones={invitaciones.data ?? []}
          onCambio={() => void invalidar('invitaciones')}
        />
      )}

      {catalogo.data && <VisorPermisos catalogo={catalogo.data} />}

      {puedeGestionar && segregacion.data && (
        <SegregacionPanel reglas={segregacion.data} onCambio={() => void invalidar('segregacion')} />
      )}
    </div>
  );
}

// ── Invitar ─────────────────────────────────────────────────────────────────────

function Invitar({ onInvitado }: { onInvitado: () => void }) {
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<string>('cajero');
  const [enlace, setEnlace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invitar = useMutation({
    mutationFn: () => usuariosApi.invitar(email, rol),
    onSuccess: (r) => {
      setError(null);
      setEmail('');
      if (r.tokenDev) {
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        setEnlace(`${origin}/invitacion/${r.tokenDev}`);
      } else {
        setEnlace(null);
      }
      onInvitado();
    },
    onError: (e) => setError(mensajeError(e)),
  });

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 text-lg font-semibold">Invitar usuario</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          invitar.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Email</span>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@empresa.com"
            className="w-64"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Rol</span>
          <Select value={rol} onChange={(e) => setRol(e.target.value)} className="w-44">
            {ROLES_ASIGNABLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" disabled={invitar.isPending}>
          {invitar.isPending ? 'Invitando…' : 'Enviar invitación'}
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      {enlace && (
        <div className="mt-3 rounded-md bg-muted p-3 text-sm">
          <p className="mb-1 font-medium">Enlace de invitación (entorno de desarrollo, sin correo):</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">
              {enlace}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(enlace)}
            >
              Copiar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Miembros ──────────────────────────────────────────────────────────────────

function MiembrosTabla({
  miembros,
  cargando,
  puedeGestionar,
  esOwner,
  onCambio,
}: {
  miembros: Miembro[];
  cargando: boolean;
  puedeGestionar: boolean;
  esOwner: boolean;
  onCambio: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const accion = useMutation({
    mutationFn: (fn: () => Promise<void>) => fn(),
    onSuccess: () => {
      setError(null);
      onCambio();
    },
    onError: (e) => setError(mensajeError(e)),
  });

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Miembros</h2>
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Usuario</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Estado</th>
              {puedeGestionar && <th className="px-3 py-2">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td className="px-3 py-3 text-muted-foreground" colSpan={4}>
                  Cargando…
                </td>
              </tr>
            )}
            {miembros.map((m) => (
              <tr key={m.membershipId} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{m.nombre}</div>
                  <div className="text-xs text-muted-foreground">{m.email}</div>
                </td>
                <td className="px-3 py-2">
                  {puedeGestionar && m.rol !== 'owner' ? (
                    <Select
                      value={m.rol}
                      className="w-36"
                      disabled={accion.isPending}
                      onChange={(e) =>
                        accion.mutate(() => usuariosApi.reasignarRol(m.membershipId, e.target.value))
                      }
                    >
                      {ROLES_ASIGNABLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="font-medium">{m.rol}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      m.status === 'active' ? 'text-green-600' : 'text-muted-foreground'
                    }
                  >
                    {m.status === 'active' ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                {puedeGestionar && (
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {m.status === 'active' ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={accion.isPending}
                          onClick={() => accion.mutate(() => usuariosApi.desactivar(m.membershipId))}
                        >
                          Desactivar
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={accion.isPending}
                          onClick={() => accion.mutate(() => usuariosApi.reactivar(m.membershipId))}
                        >
                          Reactivar
                        </Button>
                      )}
                      {esOwner && m.rol !== 'owner' && m.status === 'active' && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={accion.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Transferir la propiedad a ${m.email}? Pasarás a ser admin.`,
                              )
                            ) {
                              accion.mutate(() => usuariosApi.transferirPropiedad(m.membershipId));
                            }
                          }}
                        >
                          Hacer owner
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Invitaciones pendientes ─────────────────────────────────────────────────────

function InvitacionesPendientes({
  invitaciones,
  onCambio,
}: {
  invitaciones: Invitacion[];
  onCambio: () => void;
}) {
  const revocar = useMutation({
    mutationFn: (id: string) => usuariosApi.revocarInvitacion(id),
    onSuccess: onCambio,
  });
  if (invitaciones.length === 0) {
    return null;
  }
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Invitaciones pendientes</h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Vence</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {invitaciones.map((i) => (
              <tr key={i.id} className="border-b last:border-0">
                <td className="px-3 py-2">{i.email}</td>
                <td className="px-3 py-2">{i.rol}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {new Date(i.expiresAt).toLocaleDateString('es-VE')}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={revocar.isPending}
                    onClick={() => revocar.mutate(i.id)}
                  >
                    Revocar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Visor de permisos por rol ───────────────────────────────────────────────────

function VisorPermisos({
  catalogo,
}: {
  catalogo: { roles: { code: string }[]; permisos: { code: string; descripcion: string }[]; matriz: Record<string, string[]> };
}) {
  const roles = useMemo(() => catalogo.roles.map((r) => r.code), [catalogo.roles]);
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Permisos por rol</h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Permiso</th>
              {roles.map((r) => (
                <th key={r} className="px-3 py-2 text-center">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalogo.permisos.map((p) => (
              <tr key={p.code} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <div className="font-mono text-xs">{p.code}</div>
                  <div className="text-xs text-muted-foreground">{p.descripcion}</div>
                </td>
                {roles.map((r) => (
                  <td key={r} className="px-3 py-2 text-center">
                    {catalogo.matriz[r]?.includes(p.code) ? '✓' : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Separación de deberes ───────────────────────────────────────────────────────

function SegregacionPanel({
  reglas,
  onCambio,
}: {
  reglas: { regla: string; descripcion: string; activo: boolean }[];
  onCambio: () => void;
}) {
  const configurar = useMutation({
    mutationFn: ({ regla, activo }: { regla: string; activo: boolean }) =>
      usuariosApi.configurarSegregacion(regla, activo),
    onSuccess: onCambio,
  });
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Separación de deberes</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Reglas que impiden que una misma persona ejecute dos pasos en conflicto (docs/05 §6).
      </p>
      <ul className="space-y-2">
        {reglas.map((r) => (
          <li
            key={r.regla}
            className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm"
          >
            <div>
              <div className="font-medium">{r.descripcion}</div>
              <div className="font-mono text-xs text-muted-foreground">{r.regla}</div>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={r.activo}
                disabled={configurar.isPending}
                onChange={(e) => configurar.mutate({ regla: r.regla, activo: e.target.checked })}
              />
              <span>{r.activo ? 'Activa' : 'Inactiva'}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

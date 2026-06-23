'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/maestros-api';
import { invitacionPublicaApi } from '@/lib/usuarios-api';

/**
 * Aceptación pública de una invitación (P29). PRE-tenant: el invitado llega por el enlace con el
 * token, ve a qué empresa y con qué rol se lo invita, y —si aún no tiene cuenta— fija su nombre y
 * contraseña. Al aceptar se crea/vincula el usuario y la membresía; luego entra por `/login`.
 */
export default function AceptarInvitacionPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();

  const [nombre, setNombre] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  const peek = useQuery({
    queryKey: ['invitacion', token],
    queryFn: () => invitacionPublicaApi.peek(token),
    retry: false,
  });

  const aceptar = useMutation({
    mutationFn: () =>
      invitacionPublicaApi.aceptar(token, peek.data?.requiereRegistro ? { nombre, password } : {}),
    onSuccess: () => {
      setError(null);
      setHecho(true);
      setTimeout(() => router.push('/login'), 1500);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo aceptar la invitación'),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="rounded-lg border p-6">
        <h1 className="text-xl font-bold tracking-tight">Invitación a ContaVE</h1>

        {peek.isLoading && <p className="mt-4 text-sm text-muted-foreground">Cargando…</p>}

        {peek.isError && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-destructive">
              La invitación no es válida, fue revocada o expiró.
            </p>
            <Link href="/login" className="text-sm text-primary underline-offset-4 hover:underline">
              Ir a iniciar sesión
            </Link>
          </div>
        )}

        {peek.data && !hecho && (
          <form
            className="mt-4 space-y-4"
            onSubmit={(ev) => {
              ev.preventDefault();
              aceptar.mutate();
            }}
          >
            <p className="text-sm">
              Te invitaron a <span className="font-semibold">{peek.data.empresa}</span> como{' '}
              <span className="font-semibold">{peek.data.rol}</span> ({peek.data.email}).
            </p>

            {peek.data.requiereRegistro && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Tu nombre</span>
                  <Input
                    required
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Nombre y apellido"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Contraseña (mínimo 8 caracteres)</span>
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={aceptar.isPending}>
              {aceptar.isPending ? 'Aceptando…' : 'Aceptar invitación'}
            </Button>
          </form>
        )}

        {hecho && (
          <p className="mt-4 text-sm text-green-600">
            ¡Listo! Tu acceso quedó habilitado. Redirigiendo a iniciar sesión…
          </p>
        )}
      </div>
    </main>
  );
}

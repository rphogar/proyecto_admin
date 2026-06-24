'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { EmpresaActivaProvider } from '@/lib/empresa-activa';
import { ApiError } from '@/lib/maestros-api';
import { notificarSesionExpirada } from '@/lib/sesion-eventos';

/**
 * Detecta el 401 transversal: cualquier lectura/escritura de negocio que falle con `ApiError` 401
 * (token vencido o revocado) dispara el cierre de sesión + re-login. Se centraliza aquí —en los
 * cachés globales de TanStack Query, que se invocan ante CUALQUIER error, además de los `onError`
 * locales— para no repetir la lógica en ~12 clientes HTTP. Los 401 de `/auth/login` (credenciales
 * malas) y de la tasa pre-login lanzan `Error` genérico (sin `status`), así que no caen aquí: no se
 * confunde "credenciales inválidas" con "sesión expirada".
 */
function esSesionExpirada(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Provee TanStack Query y la empresa activa a la app. Un cliente por árbol (estable entre renders). */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            // No reintentar errores del cliente (401/403/404…): reintentar un 401 solo retrasa el
            // re-login y machaca un endpoint que va a seguir rechazando. Sí se reintenta la red.
            retry: (failureCount, error) =>
              error instanceof ApiError && error.status < 500 ? false : failureCount < 2,
          },
        },
        queryCache: new QueryCache({
          onError: (error) => {
            if (esSesionExpirada(error)) {
              notificarSesionExpirada();
            }
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            if (esSesionExpirada(error)) {
              notificarSesionExpirada();
            }
          },
        }),
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <EmpresaActivaProvider>{children}</EmpresaActivaProvider>
    </QueryClientProvider>
  );
}

'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { EmpresaActivaProvider } from '@/lib/empresa-activa';

/** Provee TanStack Query y la empresa activa a la app. Un cliente por árbol (estable entre renders). */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <EmpresaActivaProvider>{children}</EmpresaActivaProvider>
    </QueryClientProvider>
  );
}

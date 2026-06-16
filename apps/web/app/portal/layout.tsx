import type { ReactNode } from 'react';
import Link from 'next/link';
import { NavPortal } from '@/components/portal/nav-portal';

/**
 * Shell del Portal del contador (doc 06 M11). A diferencia de los demás módulos, es TENANT-level:
 * muestra toda la cartera de empresas, así que la barra superior no lleva selector de empresa
 * (la selección se hace dentro de cada vista, p. ej. al otorgar una delegación).
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          ContaVE
        </Link>
        <span className="text-sm text-muted-foreground">Portal del contador</span>
      </header>
      <div className="mx-auto flex max-w-6xl gap-8 p-6">
        <aside className="w-56 shrink-0">
          <NavPortal />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

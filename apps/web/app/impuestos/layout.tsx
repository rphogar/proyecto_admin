import type { ReactNode } from 'react';
import Link from 'next/link';
import { NavImpuestos } from '@/components/impuestos/nav-impuestos';
import { SelectorEmpresa } from '@/components/maestros/selector-empresa';

/** Shell del módulo de Impuestos: barra superior con selector de empresa + navegación lateral (doc 06 M7). */
export default function ImpuestosLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight">
          ContaVE
        </Link>
        <SelectorEmpresa />
      </header>
      <div className="mx-auto flex max-w-6xl gap-8 p-6">
        <aside className="w-56 shrink-0">
          <NavImpuestos />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

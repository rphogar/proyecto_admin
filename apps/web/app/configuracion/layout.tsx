import type { ReactNode } from 'react';
import Link from 'next/link';
import { NavConfiguracion } from '@/components/configuracion/nav-configuracion';
import { SelectorEmpresa } from '@/components/maestros/selector-empresa';

/** Shell del módulo Configuración (doc 06 M12): barra superior + navegación lateral. */
export default function ConfiguracionLayout({ children }: { children: ReactNode }) {
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
          <NavConfiguracion />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

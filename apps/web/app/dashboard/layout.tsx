import type { ReactNode } from 'react';
import Link from 'next/link';
import { SelectorEmpresa } from '@/components/maestros/selector-empresa';

/**
 * Shell del Dashboard del dueño (docs/06 M0). Móvil-primero: barra superior compacta con selector de
 * empresa y, debajo, los widgets a todo el ancho (sin navegación lateral — la consulta del dueño es
 * de un vistazo). El contenedor se ensancha en escritorio para acomodar la cuadrícula de widgets.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <Link href="/" className="text-lg font-bold tracking-tight">
          ContaVE
        </Link>
        <SelectorEmpresa />
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}

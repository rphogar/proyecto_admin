'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Entradas del módulo Nómina (doc 06 M8). */
const ENLACES = [
  { href: '/nomina/trabajadores', etiqueta: 'Trabajadores' },
  { href: '/nomina/conceptos', etiqueta: 'Conceptos' },
  { href: '/nomina/corridas', etiqueta: 'Corridas' },
  { href: '/nomina/prestaciones', etiqueta: 'Prestaciones' },
  { href: '/nomina/parafiscales', etiqueta: 'Parafiscales' },
] as const;

/** Navegación lateral del módulo Nómina. */
export function NavNomina() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 text-sm" aria-label="Nómina">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nómina</p>
      {ENLACES.map((e) => {
        const activo = pathname === e.href;
        return (
          <Link
            key={e.href}
            href={e.href}
            className={cn(
              'rounded-md px-3 py-2 transition-colors hover:bg-accent hover:text-accent-foreground',
              activo && 'bg-accent font-medium text-accent-foreground',
            )}
          >
            {e.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}

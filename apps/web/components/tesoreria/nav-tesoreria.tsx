'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Entradas del módulo Tesorería y conciliación (doc 06 M4). */
const ENLACES = [
  { href: '/tesoreria/posicion', etiqueta: 'Posición' },
  { href: '/tesoreria/transferencias', etiqueta: 'Transferencias' },
  { href: '/tesoreria/cierres-caja', etiqueta: 'Cierres de caja' },
  { href: '/tesoreria/conciliacion', etiqueta: 'Conciliación' },
] as const;

/** Navegación lateral del módulo Tesorería. */
export function NavTesoreria() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 text-sm" aria-label="Tesorería">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tesorería</p>
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

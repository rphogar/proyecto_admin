'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Entradas del módulo de Impuestos (doc 06 M7). */
const ENLACES = [
  { href: '/impuestos/iva', etiqueta: 'Planilla de IVA (99030)' },
  { href: '/impuestos/igtf', etiqueta: 'IGTF percibido' },
  { href: '/impuestos/anticipos', etiqueta: 'Anticipos SPE' },
  { href: '/impuestos/calendario', etiqueta: 'Calendario SPE' },
] as const;

/** Navegación lateral del módulo de Impuestos. */
export function NavImpuestos() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 text-sm" aria-label="Impuestos">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Impuestos</p>
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

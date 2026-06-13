'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Entradas del módulo Ventas (doc 06 M1/M3). */
const ENLACES = [
  { href: '/ventas/facturas', etiqueta: 'Facturas' },
  { href: '/ventas/facturas/nueva', etiqueta: 'Nueva factura' },
  { href: '/ventas/cobros', etiqueta: 'Cobros' },
] as const;

/** Navegación lateral del módulo Ventas. */
export function NavVentas() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 text-sm" aria-label="Ventas">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ventas</p>
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

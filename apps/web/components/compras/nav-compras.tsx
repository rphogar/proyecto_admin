'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Entradas del módulo Compras y retenciones (doc 06 M2). */
const ENLACES = [
  { href: '/compras', etiqueta: 'Facturas de compra' },
  { href: '/compras/nueva', etiqueta: 'Nueva compra' },
  { href: '/compras/retenciones-recibidas', etiqueta: 'Comprobantes recibidos' },
] as const;

/** Navegación lateral del módulo Compras. */
export function NavCompras() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 text-sm" aria-label="Compras">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Compras</p>
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

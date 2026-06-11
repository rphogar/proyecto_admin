'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Entradas del módulo Maestros (doc 06 §M12 + §3.2). */
const ENLACES = [
  { href: '/maestros/parties', etiqueta: 'Terceros' },
  { href: '/maestros/items', etiqueta: 'Ítems' },
  { href: '/maestros/price-lists', etiqueta: 'Listas de precios' },
  { href: '/maestros/warehouses', etiqueta: 'Almacenes' },
  { href: '/maestros/payment-methods', etiqueta: 'Métodos de pago' },
  { href: '/maestros/series', etiqueta: 'Series de documentos' },
] as const;

/** Navegación lateral por módulos (convención global del doc 06). */
export function NavMaestros() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 text-sm" aria-label="Maestros">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Maestros
      </p>
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

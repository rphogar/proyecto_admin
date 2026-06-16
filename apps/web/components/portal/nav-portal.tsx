'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Entradas del Portal del contador (doc 06 M11). */
const ENLACES = [
  { href: '/portal', etiqueta: 'Panel' },
  { href: '/portal/calendario', etiqueta: 'Calendario' },
  { href: '/portal/checklist', etiqueta: 'Checklist de cierre' },
  { href: '/portal/delegaciones', etiqueta: 'Delegaciones' },
] as const;

/** Navegación lateral del Portal del contador. */
export function NavPortal() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 text-sm" aria-label="Portal del contador">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Portal</p>
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

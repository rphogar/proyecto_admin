'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Entradas del módulo Configuración (doc 06 §M12). Por ahora, Usuarios/roles/permisos (P29). */
const ENLACES = [{ href: '/configuracion/usuarios', etiqueta: 'Usuarios y roles' }] as const;

/** Navegación lateral de Configuración (convención global del doc 06). */
export function NavConfiguracion() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 text-sm" aria-label="Configuración">
      <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Configuración
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

import * as React from 'react';

import { cn } from '@/lib/utils';

/** Input de texto base (estilo shadcn) usado en los formularios de maestros. */
function Input({ className, type, ...props }: React.ComponentProps<'input'>): React.JSX.Element {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-colors',
        'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

/** Select nativo con el mismo encuadre visual que `Input`. */
function Select({ className, children, ...props }: React.ComponentProps<'select'>): React.JSX.Element {
  return (
    <select
      data-slot="select"
      className={cn(
        'flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Input, Select };

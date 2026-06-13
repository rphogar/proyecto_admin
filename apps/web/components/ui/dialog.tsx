'use client';

import type { ReactNode } from 'react';

/**
 * Modal mínimo (sin dependencias) para confirmaciones, el asistente de NC/ND y el cobro. Cierra al
 * hacer clic en el telón o en la X; el contenido se centra. Coherente con el estilo de los maestros.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} max-h-[90vh] overflow-auto rounded-lg border bg-background p-5 shadow-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

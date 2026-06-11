'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEmpresaActiva } from '@/lib/empresa-activa';

/**
 * Selector de empresa de la barra superior (doc 06, multi-empresa). Provisional: hasta el módulo de
 * empresas (M12) se captura el UUID de la empresa activa, que se persiste en `localStorage` y acota
 * todos los maestros. Se reemplazará por un desplegable poblado desde la API.
 */
export function SelectorEmpresa() {
  const { companyId, setCompanyId } = useEmpresaActiva();
  const [valor, setValor] = useState('');

  if (companyId !== null) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Empresa:</span>
        <code className="rounded bg-muted px-2 py-1 text-xs">{companyId}</code>
        <Button size="sm" variant="ghost" onClick={() => setCompanyId(null)}>
          Cambiar
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valor.trim()) {
          setCompanyId(valor.trim());
        }
      }}
    >
      <Input
        className="w-80"
        placeholder="UUID de la empresa activa"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        aria-label="UUID de la empresa activa"
      />
      <Button size="sm" type="submit">
        Usar
      </Button>
    </form>
  );
}

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchSesionDemo } from '@/lib/dev-api';
import { useEmpresaActiva } from '@/lib/empresa-activa';

/**
 * Selector de empresa de la barra superior (doc 06, multi-empresa). Provisional: hasta que exista
 * la auth real (login/JWT/membresías), se entra con un clic a la empresa DEMO sembrada por
 * `pnpm db:seed-demo` (endpoint `GET /dev/sesion`). Reemplaza al "pegar UUID a mano".
 */
export function SelectorEmpresa() {
  const { sesion, iniciarSesion, salir } = useEmpresaActiva();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sesion !== null) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Empresa:</span>
        <span className="font-medium">{sesion.empresaNombre}</span>
        <Button size="sm" variant="ghost" onClick={salir}>
          Salir
        </Button>
      </div>
    );
  }

  const entrar = async () => {
    setCargando(true);
    setError(null);
    try {
      iniciarSesion(await fetchSesionDemo());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión demo');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={entrar} disabled={cargando}>
        {cargando ? 'Entrando…' : 'Entrar (empresa demo)'}
      </Button>
      {error !== null && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

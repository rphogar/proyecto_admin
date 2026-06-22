'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useEmpresaActiva } from '@/lib/empresa-activa';

/**
 * Selector de empresa de la barra superior (docs/06, multi-empresa). Con la auth real (P28): si no
 * hay sesión, enlaza al login; con sesión, deja cambiar de empresa (tenant, re-emite token validando
 * la membresía) y, si el tenant tiene varias, de empresa de trabajo (RIF) dentro del tenant.
 */
export function SelectorEmpresa() {
  const { sesion, cambiarEmpresa, setCompanyId, salir } = useEmpresaActiva();
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sesion === null) {
    return (
      <Button asChild size="sm">
        <Link href="/login">Iniciar sesión</Link>
      </Button>
    );
  }

  const onCambiarTenant = async (tenantId: string) => {
    if (tenantId === sesion.tenantActivo) {
      return;
    }
    setCargando(true);
    setError(null);
    try {
      await cambiarEmpresa(tenantId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar de empresa');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      {sesion.empresas.length > 1 ? (
        <select
          aria-label="Empresa"
          className="h-8 rounded-md border bg-background px-2"
          value={sesion.tenantActivo}
          disabled={cargando}
          onChange={(e) => void onCambiarTenant(e.target.value)}
        >
          {sesion.empresas.map((e) => (
            <option key={e.tenantId} value={e.tenantId}>
              {e.nombre}
            </option>
          ))}
        </select>
      ) : (
        <span className="font-medium">{sesion.empresas[0]?.nombre ?? sesion.empresaNombre}</span>
      )}

      {sesion.companias.length > 1 && (
        <select
          aria-label="Empresa de trabajo"
          className="h-8 rounded-md border bg-background px-2"
          value={sesion.companyId}
          disabled={cargando}
          onChange={(e) => setCompanyId(e.target.value)}
        >
          {sesion.companias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razonSocial}
            </option>
          ))}
        </select>
      )}

      <Button size="sm" variant="ghost" onClick={salir} disabled={cargando}>
        Salir
      </Button>
      {error !== null && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

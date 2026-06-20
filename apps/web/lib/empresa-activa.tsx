'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import {
  guardarSesion,
  leerSesion,
  limpiarSesion,
  type SesionActiva,
} from '@/lib/contexto-sesion';

/**
 * Sesión/empresa activa (doc 06: "selector de empresa" en la barra superior, multi-empresa).
 * La sesión (tenant + empresa + usuario) se persiste en `localStorage` (ver `contexto-sesion.ts`)
 * y de ahí salen las cabeceras `x-tenant-id`/`x-user-id` de cada llamada a la API.
 *
 * Compatibilidad: `companyId`/`setCompanyId` se conservan porque ~20 pantallas los consumen.
 * `setCompanyId(null)` cierra la sesión (logout); la entrada se hace con `iniciarSesion`.
 */
interface EmpresaActiva {
  companyId: string | null;
  setCompanyId: (id: string | null) => void;
  sesion: SesionActiva | null;
  iniciarSesion: (s: SesionActiva) => void;
  salir: () => void;
}

const Ctx = createContext<EmpresaActiva | undefined>(undefined);

export function EmpresaActivaProvider({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<SesionActiva | null>(null);

  // Hidrata desde localStorage en el cliente (evita desajuste SSR).
  useEffect(() => {
    setSesion(leerSesion());
  }, []);

  const iniciarSesion = useCallback((s: SesionActiva) => {
    guardarSesion(s);
    setSesion(s);
  }, []);

  const salir = useCallback(() => {
    limpiarSesion();
    setSesion(null);
  }, []);

  // Legado: `setCompanyId(null)` = salir. Con un valor, solo cambia la empresa de la sesión actual.
  const setCompanyId = useCallback(
    (id: string | null) => {
      if (id === null) {
        limpiarSesion();
        setSesion(null);
        return;
      }
      setSesion((prev) => {
        if (prev === null) {
          return prev;
        }
        const next = { ...prev, companyId: id };
        guardarSesion(next);
        return next;
      });
    },
    [],
  );

  return (
    <Ctx.Provider
      value={{ companyId: sesion?.companyId ?? null, setCompanyId, sesion, iniciarSesion, salir }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useEmpresaActiva(): EmpresaActiva {
  const ctx = useContext(Ctx);
  if (ctx === undefined) {
    throw new Error('useEmpresaActiva debe usarse dentro de EmpresaActivaProvider');
  }
  return ctx;
}

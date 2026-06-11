'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Empresa activa de la sesión (doc 06: "selector de empresa" en la barra superior, multi-empresa).
 * Hasta que exista la API/онboarding de empresas (M12), se persiste el UUID elegido en
 * `localStorage`. Todos los maestros son company-scoped y la cuelgan de aquí.
 */
interface EmpresaActiva {
  companyId: string | null;
  setCompanyId: (id: string | null) => void;
}

const Ctx = createContext<EmpresaActiva | undefined>(undefined);
const CLAVE = 'contave.companyId';

export function EmpresaActivaProvider({ children }: { children: ReactNode }) {
  const [companyId, setCompanyIdState] = useState<string | null>(null);

  // Hidrata desde localStorage en el cliente (evita desajuste SSR).
  useEffect(() => {
    const guardado = window.localStorage.getItem(CLAVE);
    if (guardado) {
      setCompanyIdState(guardado);
    }
  }, []);

  const setCompanyId = useCallback((id: string | null) => {
    setCompanyIdState(id);
    if (id) {
      window.localStorage.setItem(CLAVE, id);
    } else {
      window.localStorage.removeItem(CLAVE);
    }
  }, []);

  return <Ctx.Provider value={{ companyId, setCompanyId }}>{children}</Ctx.Provider>;
}

export function useEmpresaActiva(): EmpresaActiva {
  const ctx = useContext(Ctx);
  if (ctx === undefined) {
    throw new Error('useEmpresaActiva debe usarse dentro de EmpresaActivaProvider');
  }
  return ctx;
}

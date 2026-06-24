'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  cambiarEmpresa as apiCambiarEmpresa,
  listarCompanias,
  logout as apiLogout,
  refrescar,
  type SesionEmitida,
} from '@/lib/auth-api';
import {
  guardarSesion,
  leerSesion,
  limpiarSesion,
  type SesionActiva,
} from '@/lib/contexto-sesion';
import { alExpirarSesion, PARAM_SESION_EXPIRADA } from '@/lib/sesion-eventos';

/**
 * Sesión/empresa activa (P28, docs/06: "selector de empresa" multi-empresa). La sesión real (access
 * JWT acotado a un tenant + refresh rotativo + lista de empresas) se persiste en `localStorage`. De
 * `cabecerasAuth()` sale el `Authorization: Bearer` de cada llamada. Este provider:
 *  - construye la sesión a partir de lo que devuelve el login (resolviendo la empresa de trabajo),
 *  - refresca el access proactivamente antes de que expire,
 *  - cambia de empresa (re-emite token validando la membresía en la API),
 *  - cierra sesión (revoca en el servidor).
 *
 * Compatibilidad: `companyId`/`setCompanyId` se conservan porque ~20 pantallas los consumen.
 */
interface EmpresaActiva {
  companyId: string | null;
  setCompanyId: (id: string | null) => void;
  sesion: SesionActiva | null;
  /** Entra con la sesión emitida por el login (resuelve la empresa de trabajo). */
  iniciarSesion: (emitida: SesionEmitida) => Promise<void>;
  /** Cambia de empresa/tenant (re-emite un token acotado validando la membresía). */
  cambiarEmpresa: (tenantId: string) => Promise<void>;
  salir: () => void;
}

const Ctx = createContext<EmpresaActiva | undefined>(undefined);

/** Construye la sesión persistible a partir de los tokens del login/cambio de empresa. */
async function construirSesion(emitida: SesionEmitida): Promise<SesionActiva> {
  const companias = await listarCompanias(emitida.accessToken);
  const primera = companias[0];
  const nombreTenant =
    emitida.empresas.find((e) => e.tenantId === emitida.tenantActivo)?.nombre ?? '';
  return {
    accessToken: emitida.accessToken,
    refreshToken: emitida.refreshToken,
    tenantActivo: emitida.tenantActivo,
    expiraEn: Date.now() + emitida.expiraEnSeg * 1000,
    empresas: emitida.empresas,
    companias,
    companyId: primera?.id ?? '',
    empresaNombre: primera?.razonSocial ?? nombreTenant,
  };
}

export function EmpresaActivaProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sesion, setSesion] = useState<SesionActiva | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hidrata desde localStorage en el cliente (evita desajuste SSR).
  useEffect(() => {
    setSesion(leerSesion());
  }, []);

  const aplicar = useCallback((s: SesionActiva) => {
    guardarSesion(s);
    setSesion(s);
  }, []);

  const salir = useCallback(() => {
    const actual = leerSesion();
    if (actual !== null) {
      void apiLogout(actual.refreshToken).catch(() => undefined); // logout idempotente
    }
    limpiarSesion();
    setSesion(null);
  }, []);

  const iniciarSesion = useCallback(
    async (emitida: SesionEmitida) => {
      aplicar(await construirSesion(emitida));
    },
    [aplicar],
  );

  // Guardia de sesión expirada (P32): un 401 en cualquier llamada de negocio emite el evento; aquí se
  // cierra la sesión local y se manda al login con el aviso. Se evita el redirect si ya estamos en
  // `/login` (p.ej. el 401 de un refresh fallido durante el propio login) para no entrar en bucle.
  useEffect(() => {
    return alExpirarSesion(() => {
      const habiaSesion = leerSesion() !== null;
      salir();
      if (habiaSesion && pathname !== '/login') {
        router.replace(`/login?${PARAM_SESION_EXPIRADA}=1`);
      }
    });
  }, [salir, router, pathname]);

  const cambiarEmpresa = useCallback(
    async (tenantId: string) => {
      const actual = leerSesion();
      if (actual === null) {
        return;
      }
      const emitida = await apiCambiarEmpresa(actual.accessToken, tenantId);
      aplicar(await construirSesion(emitida));
    },
    [aplicar],
  );

  // Refresco proactivo: rota el access ~1 min antes de expirar; si falla, cierra sesión.
  useEffect(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (sesion === null) {
      return;
    }
    const margen = 60_000;
    const espera = Math.max(0, sesion.expiraEn - Date.now() - margen);
    timer.current = setTimeout(() => {
      void (async () => {
        try {
          const par = await refrescar(sesion.refreshToken);
          aplicar({
            ...sesion,
            accessToken: par.accessToken,
            refreshToken: par.refreshToken,
            expiraEn: Date.now() + par.expiraEnSeg * 1000,
          });
        } catch {
          salir();
        }
      })();
    }, espera);
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, [sesion, aplicar, salir]);

  // Legado: cambia la empresa (RIF) activa DENTRO del tenant; `setCompanyId(null)` = salir.
  const setCompanyId = useCallback(
    (id: string | null) => {
      if (id === null) {
        salir();
        return;
      }
      const actual = leerSesion();
      if (actual === null) {
        return;
      }
      const comp = actual.companias.find((c) => c.id === id);
      aplicar({
        ...actual,
        companyId: id,
        empresaNombre: comp?.razonSocial ?? actual.empresaNombre,
      });
    },
    [aplicar, salir],
  );

  return (
    <Ctx.Provider
      value={{
        companyId: sesion?.companyId ?? null,
        setCompanyId,
        sesion,
        iniciarSesion,
        cambiarEmpresa,
        salir,
      }}
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

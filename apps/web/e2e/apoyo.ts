import type { Page, Route } from '@playwright/test';

/**
 * Apoyo para los e2e transversales (P32). Estas pruebas ejercitan la **UI real** (Next.js en un
 * navegador real: enrutado, React, `localStorage`, manejo de sesión y errores) con el **backend
 * mockeado** a nivel de red (`page.route`). Así corren de forma determinista y sin Docker —tanto en
 * local como en CI—, complementando la cobertura e2e de servicios sobre Postgres real que ya vive en
 * `apps/api/src/seguridad/flujos-transversales.int.spec.ts` (los 5 flujos) y en los casos 53–57.
 *
 * Lo que el navegador SÍ verifica aquí y la capa API no puede: login + 2FA, cambio de empresa,
 * sesión expirada → re-login, 403 con mensaje claro (caso 54), el estado "0 filas" de RLS (caso 55)
 * y el banner de tasa rezagada (caso 57).
 */

/** Base de la API que usan los clientes HTTP del front (igual default que `lib/*-api.ts`). */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const TENANT_A = '00000000-0000-0000-0000-0000000000a1';
export const TENANT_B = '00000000-0000-0000-0000-0000000000a2';
export const COMPANY_A = '00000000-0000-0000-0000-0000000000c1';
export const COMPANY_B = '00000000-0000-0000-0000-0000000000c2';

export interface Membresia {
  tenantId: string;
  nombre: string;
  rol: string;
}
export interface Compania {
  id: string;
  rif: string;
  razonSocial: string;
}

/** Sesión persistida (espejo de `SesionActiva` de `lib/contexto-sesion.ts`). */
export interface SesionMock {
  accessToken: string;
  refreshToken: string;
  tenantActivo: string;
  expiraEn: number;
  empresas: Membresia[];
  companias: Compania[];
  companyId: string;
  empresaNombre: string;
}

const EMPRESAS_DEMO: Membresia[] = [
  { tenantId: TENANT_A, nombre: 'Distribuidora Demo, C.A.', rol: 'owner' },
  { tenantId: TENANT_B, nombre: 'Bodegón Don José, C.A.', rol: 'owner' },
];
const COMPANIAS_A: Compania[] = [
  { id: COMPANY_A, rif: 'J-30123456-7', razonSocial: 'Distribuidora Demo, C.A.' },
];
const COMPANIAS_B: Compania[] = [
  { id: COMPANY_B, rif: 'J-40987654-3', razonSocial: 'Bodegón Don José, C.A.' },
];

/** Empresas (RIF) del tenant activo, para `GET /maestros/companias` y `construirSesion`. */
export function companiasDe(tenant: string): Compania[] {
  return tenant === TENANT_B ? COMPANIAS_B : COMPANIAS_A;
}

/** Una sesión válida ya iniciada (para sembrar `localStorage` antes de navegar). */
export function sesionDemo(overrides: Partial<SesionMock> = {}): SesionMock {
  const companias = companiasDe(overrides.tenantActivo ?? TENANT_A);
  return {
    accessToken: 'acc-demo',
    refreshToken: 'ref-demo',
    tenantActivo: TENANT_A,
    expiraEn: Date.now() + 3_600_000, // lejano: no dispara el refresh proactivo durante el test
    empresas: EMPRESAS_DEMO,
    companias,
    companyId: companias[0]!.id,
    empresaNombre: companias[0]!.razonSocial,
    ...overrides,
  };
}

/** Lo que devuelve el login / cambio de empresa (espejo de `SesionEmitida`). */
export function sesionEmitida(tenantActivo: string = TENANT_A) {
  return {
    accessToken: `acc-${tenantActivo}`,
    refreshToken: `ref-${tenantActivo}`,
    expiraEnSeg: 900,
    tenantActivo,
    empresas: EMPRESAS_DEMO,
  };
}

/** DTO de dashboard "vacío" pero estructuralmente completo (no rompe el render). */
export function dashboardVacio() {
  const cero = { ves: '0', usd: '0' };
  const comp = { actual: cero, anterior: cero, variacionPct: null };
  return {
    fecha: '2026-06-23',
    caja: { totalVes: '0', totalUsd: '0', metodos: [] },
    ventas: { dia: comp, semana: comp, mes: comp },
    utilidadMes: cero,
    tasaBcv: null,
    tasaBcvEur: null,
    cxc: { topDeudores: [], totalVencido: cero, totalPorCobrar: cero },
    cxp: { proximas: [], totalPorPagar: cero },
    semaforoFiscal: { obligaciones: [] },
    topProductos: [],
    alertas: [],
  };
}

/** Tasa del día (caso 57): `frescura` controla el banner de rezago. */
export function tasaDelDia(frescura: 'fresca' | 'rezagada' | 'critica' = 'fresca', moneda = 'USD') {
  return {
    moneda,
    fecha: '2026-06-23',
    rate: '40.00000000',
    rateDate: '2026-06-23',
    source: 'BCV',
    frescura,
  };
}

interface RespuestaMock {
  status?: number;
  json?: unknown;
}
interface InfoRuta {
  pathname: string;
  method: string;
  body: unknown;
}
/** Manejador a medida del test: devuelve una respuesta o `undefined` para caer al default. */
type Manejador = (info: InfoRuta) => RespuestaMock | undefined;

async function responder(route: Route, { status = 200, json }: RespuestaMock): Promise<void> {
  if (status === 204) {
    await route.fulfill({ status });
    return;
  }
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(json ?? {}),
  });
}

/**
 * Intercepta TODAS las llamadas a la API y responde con datos canónicos. `manejador` (opcional)
 * tiene prioridad: lo que devuelva gana; si devuelve `undefined`, se aplica el default del endpoint.
 */
export async function mockApi(page: Page, manejador?: Manejador): Promise<void> {
  await page.route(`${API_BASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathname = url.pathname;
    const method = req.method();
    let body: unknown;
    try {
      body = req.postData() ? JSON.parse(req.postData() as string) : undefined;
    } catch {
      body = undefined;
    }

    const aMedida = manejador?.({ pathname, method, body });
    if (aMedida !== undefined) {
      await responder(route, aMedida);
      return;
    }

    // Defaults por endpoint.
    if (pathname === '/auth/login') {
      await responder(route, { json: { requiere2fa: false, ...sesionEmitida() } });
      return;
    }
    if (pathname === '/auth/login/2fa') {
      await responder(route, { json: sesionEmitida() });
      return;
    }
    if (pathname === '/auth/cambiar-empresa') {
      const tid = (body as { tenantId?: string } | undefined)?.tenantId ?? TENANT_A;
      await responder(route, { json: sesionEmitida(tid) });
      return;
    }
    if (pathname === '/auth/refresh') {
      await responder(route, {
        json: { accessToken: 'acc-rot', refreshToken: 'ref-rot', expiraEnSeg: 900 },
      });
      return;
    }
    if (pathname === '/auth/logout') {
      await responder(route, { status: 204 });
      return;
    }
    if (pathname === '/auth/empresas') {
      await responder(route, { json: EMPRESAS_DEMO });
      return;
    }
    if (pathname === '/maestros/companias') {
      // El tenant sale del token (no de un query param). Los tokens emitidos son `acc-<tenant>`.
      const auth = req.headers()['authorization'] ?? '';
      await responder(route, { json: companiasDe(auth.includes(TENANT_B) ? TENANT_B : TENANT_A) });
      return;
    }
    if (pathname.startsWith('/tasas/dia')) {
      await responder(route, { json: tasaDelDia('fresca', url.searchParams.get('moneda') ?? 'USD') });
      return;
    }
    if (pathname.startsWith('/dashboard')) {
      await responder(route, { json: dashboardVacio() });
      return;
    }
    // Cualquier otro maestro/listado: vacío (evita que la página se cuelgue esperando datos).
    await responder(route, { json: [] });
  });
}

/** Siembra una sesión ya iniciada en `localStorage` antes de cargar la app. */
export async function sembrarSesion(page: Page, sesion: SesionMock = sesionDemo()): Promise<void> {
  await page.addInitScript((s) => {
    window.localStorage.setItem('contave.sesion', JSON.stringify(s));
  }, sesion);
}

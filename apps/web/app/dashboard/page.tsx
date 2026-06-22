'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, type DashboardDto, type MontoDoble, type VentasComparativo } from '@/lib/dashboard-api';
import { useEmpresaActiva } from '@/lib/empresa-activa';

type Vista = 'USD' | 'VES';

/** Formatea un monto de la base elegida (USD por defecto para el dueño, docs/01 §2). */
function fmt(vista: Vista, m: MontoDoble): string {
  const valor = vista === 'USD' ? m.usd : m.ves;
  const n = Number(valor);
  const s = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0);
  return vista === 'USD' ? `$${s}` : `Bs ${s}`;
}

/** Limpia un teléfono venezolano a formato wa.me (E.164 sin '+'): 0414… → 58414…. */
function waLink(telefono: string | null, mensaje: string): string | null {
  if (telefono === null) return null;
  let d = telefono.replace(/\D/g, '');
  if (d.startsWith('0')) d = `58${d.slice(1)}`;
  else if (!d.startsWith('58')) d = `58${d}`;
  if (d.length < 11) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(mensaje)}`;
}

/** Dashboard del dueño (P14, docs/06 M0): móvil-primero, USD por defecto con toggle a Bs. */
export default function DashboardPage() {
  const { companyId } = useEmpresaActiva();
  const [vista, setVista] = useState<Vista>('USD');
  const q = useQuery({
    queryKey: ['dashboard', companyId],
    queryFn: () => dashboardApi.resumen(companyId as string),
    enabled: companyId !== null,
    // El dueño quiere la cifra del momento: refrescar al volver a la pestaña, sin caché agresiva.
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });

  if (companyId === null) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Selecciona una empresa en la barra superior para ver tu resumen.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mi negocio hoy</h1>
          {q.data && <p className="text-xs text-muted-foreground">Al {q.data.fecha} · datos en vivo desde el ledger</p>}
        </div>
        <div className="inline-flex overflow-hidden rounded-md border text-sm" role="group" aria-label="Moneda de vista">
          {(['USD', 'VES'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVista(v)} className={`px-3 py-1.5 ${vista === v ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground'}`}>
              {v === 'USD' ? 'USD' : 'Bs'}
            </button>
          ))}
        </div>
      </header>

      <AccesosRapidos />

      {q.isLoading && <p className="text-sm text-muted-foreground">Cargando tu resumen…</p>}
      {q.isError && <p role="alert" className="rounded-lg border border-destructive/50 p-4 text-sm text-destructive">No se pudo cargar el dashboard.</p>}

      {q.data && <Widgets data={q.data} vista={vista} />}
    </div>
  );
}

/** Botones rápidos del dueño (docs/06 M0): + Factura, + Cobro, + Gasto, Ver caja. */
function AccesosRapidos() {
  const acciones = [
    { href: '/ventas/facturas/nueva', etiqueta: '+ Factura' },
    { href: '/ventas/cobros', etiqueta: '+ Cobro' },
    { href: '/compras/nueva', etiqueta: '+ Gasto' },
    { href: '/tesoreria/posicion', etiqueta: 'Ver caja' },
  ];
  return (
    <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Accesos rápidos">
      {acciones.map((a) => (
        <Link key={a.href} href={a.href} className="rounded-lg border bg-card px-3 py-3 text-center text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground">
          {a.etiqueta}
        </Link>
      ))}
    </nav>
  );
}

function Widgets({ data, vista }: { data: DashboardDto; vista: Vista }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Alertas data={data} />
      <Caja data={data} vista={vista} />
      <Ventas data={data} vista={vista} />
      <Utilidad data={data} vista={vista} />
      <TasaBcv data={data} />
      <Cxc data={data} vista={vista} />
      <Cxp data={data} vista={vista} />
      <Semaforo data={data} />
      <TopProductos data={data} vista={vista} />
    </div>
  );
}

// ── Tarjeta base ────────────────────────────────────────────────────────────────

function Card({ titulo, accion, children, className }: { titulo: string; accion?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm ${className ?? ''}`}>
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h2>
        {accion}
      </header>
      {children}
    </section>
  );
}

/** Pastilla de variación: verde si subió, rojo si bajó, gris si no hay comparación. */
function Variacion({ pct }: { pct: string | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">sin comparación</span>;
  const n = Number(pct);
  const arriba = n >= 0;
  return (
    <span className={`text-xs font-medium ${arriba ? 'text-emerald-600' : 'text-red-600'}`}>
      {arriba ? '▲' : '▼'} {Math.abs(n).toFixed(1)}%
    </span>
  );
}

// ── Widgets ─────────────────────────────────────────────────────────────────────

function Caja({ data, vista }: { data: DashboardDto; vista: Vista }) {
  const total: MontoDoble = { ves: data.caja.totalVes, usd: data.caja.totalUsd };
  const metodos = data.caja.metodos.filter((m) => Number(m.saldoVes) !== 0 || Number(m.saldoUsd) !== 0);
  return (
    <Card titulo="Caja consolidada hoy">
      <p className="text-3xl font-semibold tabular-nums">{fmt(vista, total)}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {metodos.length === 0 && <li className="text-muted-foreground">Sin saldos de caja/banco todavía.</li>}
        {metodos.map((m) => (
          <li key={m.codigo} className="flex items-center justify-between">
            <span className="text-muted-foreground">{m.nombre}</span>
            <span className="tabular-nums">{fmt(vista, { ves: m.saldoVes, usd: m.saldoUsd })}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function VentaFila({ etiqueta, c, vista }: { etiqueta: string; c: VentasComparativo; vista: Vista }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted-foreground">{etiqueta}</span>
      <span className="flex items-baseline gap-2">
        <span className="tabular-nums font-medium">{fmt(vista, c.actual)}</span>
        <Variacion pct={c.variacionPct} />
      </span>
    </div>
  );
}

function Ventas({ data, vista }: { data: DashboardDto; vista: Vista }) {
  return (
    <Card titulo="Ventas vs período anterior">
      <div className="flex flex-col gap-2">
        <VentaFila etiqueta="Hoy" c={data.ventas.dia} vista={vista} />
        <VentaFila etiqueta="Últimos 7 días" c={data.ventas.semana} vista={vista} />
        <VentaFila etiqueta="Mes en curso" c={data.ventas.mes} vista={vista} />
      </div>
    </Card>
  );
}

function Utilidad({ data, vista }: { data: DashboardDto; vista: Vista }) {
  const u = Number(data.utilidadMes.usd);
  return (
    <Card titulo="Utilidad del mes (gerencial)">
      <p className={`text-3xl font-semibold tabular-nums ${u < 0 ? 'text-red-600' : ''}`}>{fmt(vista, data.utilidadMes)}</p>
      <p className="text-xs text-muted-foreground">Ingresos − costos − gastos del mes, derivado del ledger.</p>
    </Card>
  );
}

type TasaCard = DashboardDto['tasaBcv'];

function TasaLinea({ t }: { t: TasaCard }) {
  if (t === null || t.rate === null) {
    return <p className="text-sm text-muted-foreground">Sin tasa registrada.</p>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <p className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">Bs {t.rate.replace('.', ',')}</span>
        <Variacion pct={t.variacionPct} />
      </p>
      <p className="text-xs text-muted-foreground">
        {t.moneda}/VES · vigente {t.rateDate}
        {t.frescura !== 'fresca' && <span className="ml-1 text-amber-600">· tasa {t.frescura}</span>}
      </p>
    </div>
  );
}

function TasaBcv({ data }: { data: DashboardDto }) {
  return (
    <Card titulo="Tasa BCV del día">
      <div className="flex flex-col gap-3">
        <TasaLinea t={data.tasaBcv} />
        <div className="border-t pt-3">
          <TasaLinea t={data.tasaBcvEur} />
        </div>
      </div>
    </Card>
  );
}

function Cxc({ data, vista }: { data: DashboardDto; vista: Vista }) {
  const { topDeudores, totalVencido, totalPorCobrar } = data.cxc;
  return (
    <Card titulo="Por cobrar">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Total cartera</span>
        <span className="tabular-nums font-medium">{fmt(vista, totalPorCobrar)}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Vencido</span>
        <span className="tabular-nums font-medium text-red-600">{fmt(vista, totalVencido)}</span>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {topDeudores.length === 0 && <li className="text-muted-foreground">Sin cuentas por cobrar.</li>}
        {topDeudores.map((d) => {
          const wa = waLink(d.telefono, `Hola ${d.nombre}, te recordamos el saldo pendiente de $${d.saldoUsd}. ¡Gracias!`);
          return (
            <li key={d.partyId} className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate">{d.nombre}</span>
                {d.diasVencido > 0 && <span className="text-xs text-red-600">{d.diasVencido} días vencido</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums">{fmt(vista, { ves: d.saldoVes, usd: d.saldoUsd })}</span>
                {wa !== null && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="rounded-md border px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50" title="Recordar por WhatsApp">
                    WhatsApp
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Cxp({ data, vista }: { data: DashboardDto; vista: Vista }) {
  const { proximas, totalPorPagar } = data.cxp;
  return (
    <Card titulo="Por pagar (próximos)">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Total a proveedores</span>
        <span className="tabular-nums font-medium">{fmt(vista, totalPorPagar)}</span>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {proximas.length === 0 && <li className="text-muted-foreground">Sin cuentas por pagar.</li>}
        {proximas.map((p) => (
          <li key={p.partyId} className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate">{p.nombre}</span>
              {p.diasRestantes !== null && (
                <span className={`text-xs ${p.diasRestantes < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {p.diasRestantes < 0 ? `vencido hace ${-p.diasRestantes} días` : `vence en ${p.diasRestantes} días`}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">{fmt(vista, { ves: p.saldoVes, usd: p.saldoUsd })}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Semaforo({ data }: { data: DashboardDto }) {
  const color = (o: { estado: string; diasRestantes: number }) =>
    o.estado === 'PRESENTADA' ? 'bg-emerald-500' : o.diasRestantes < 0 ? 'bg-red-500' : o.diasRestantes <= 5 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <Card titulo="Semáforo fiscal">
      <ul className="flex flex-col gap-2 text-sm">
        {data.semaforoFiscal.obligaciones.length === 0 && <li className="text-muted-foreground">Sin obligaciones próximas.</li>}
        {data.semaforoFiscal.obligaciones.map((o) => (
          <li key={`${o.tipo}-${o.periodo}`} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color(o)}`} aria-hidden />
              <span>
                {o.tipo} {o.periodo}
                <span className="block text-xs text-muted-foreground">vence {o.fechaLimite}</span>
              </span>
            </span>
            <span className="shrink-0 text-xs">
              {o.estado === 'PRESENTADA' ? (
                <span className="text-emerald-600">presentada</span>
              ) : o.diasRestantes < 0 ? (
                <span className="text-red-600">vencida</span>
              ) : (
                <span className="text-muted-foreground">{o.diasRestantes} días</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TopProductos({ data, vista }: { data: DashboardDto; vista: Vista }) {
  return (
    <Card titulo="Top productos del mes" className="md:col-span-2">
      <ul className="flex flex-col gap-2 text-sm">
        {data.topProductos.length === 0 && <li className="text-muted-foreground">Sin ventas de productos este mes.</li>}
        {data.topProductos.map((p) => (
          <li key={p.sku} className="flex items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate">{p.descripcion}</span>
              <span className="text-xs text-muted-foreground">{p.sku} · {Number(p.cantidad).toLocaleString('es-VE')} und</span>
            </span>
            <span className="shrink-0 tabular-nums font-medium">{fmt(vista, { ves: p.ventasVes, usd: p.ventasUsd })}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Alertas({ data }: { data: DashboardDto }) {
  if (data.alertas.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 md:col-span-2" aria-label="Alertas">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">Alertas</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {data.alertas.map((a, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.severidad === 'alta' ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden />
            <span className={a.severidad === 'alta' ? 'text-red-800' : 'text-amber-900'}>{a.mensaje}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

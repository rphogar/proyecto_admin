'use client';

import { validarRif } from '@contave/shared';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RifFeedback } from '@/components/maestros/rif-feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEmpresaActiva } from '@/lib/empresa-activa';
import {
  type DatosEmpresaInput,
  type PerfilInferido,
  type RenglonAperturaInput,
  type ResultadoCrearEmpresa,
  onboardingApi,
} from '@/lib/onboarding-api';

/**
 * Asistente de alta de empresa (P30, docs/06 flujo #5 "Onboarding", meta: facturando en < 30 min).
 * Cuatro pasos: identidad (RIF), perfil tributario inferido (docs/02 §1), precarga de configuración y
 * saldos iniciales → asiento de apertura en 3 bases. Reusa el login real (P28): el tenant sale del JWT.
 */

type Paso = 1 | 2 | 3 | 4 | 5;

interface RenglonUI extends RenglonAperturaInput {
  key: string;
}

const RIESGOS = ['minimo', 'medio', 'maximo'] as const;

function nuevoRenglon(): RenglonUI {
  return { key: crypto.randomUUID(), naturaleza: 'ACTIVO', cuenta: '', moneda: 'VES', montoOrigen: '' };
}

/** Diferencia (activos − pasivos − capital) que irá a 3.3 Resultados acumulados, en VES. */
function calcularDiferenciaVes(renglones: RenglonUI[], capitalVes: string): number {
  let activos = 0;
  let pasivos = 0;
  for (const r of renglones) {
    const monto = Number(r.montoOrigen);
    if (!Number.isFinite(monto) || monto <= 0) continue;
    const ves = r.moneda.toUpperCase() === 'VES' ? monto : monto * Number(r.rateBcv ?? 0);
    if (!Number.isFinite(ves)) continue;
    if (r.naturaleza === 'ACTIVO') activos += ves;
    else pasivos += ves;
  }
  const capital = Number(capitalVes);
  return activos - pasivos - (Number.isFinite(capital) ? capital : 0);
}

export default function OnboardingPage() {
  const { setCompanyId } = useEmpresaActiva();
  const [paso, setPaso] = useState<Paso>(1);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Paso 1–2: datos de la empresa.
  const [datos, setDatos] = useState<DatosEmpresaInput>({
    rif: '',
    razonSocial: '',
    direccionFiscal: '',
    tipoContribuyente: 'ORDINARIO',
    formaJuridica: 'PJ',
    ejercicioFiscalInicio: 1,
  });
  const [perfil, setPerfil] = useState<PerfilInferido | null>(null);

  // Paso 3: empresa creada.
  const [empresa, setEmpresa] = useState<ResultadoCrearEmpresa | null>(null);

  // Paso 4: saldos iniciales.
  const [renglones, setRenglones] = useState<RenglonUI[]>([nuevoRenglon()]);
  const [capitalVes, setCapitalVes] = useState('0');
  const [rateUsdMgmt, setRateUsdMgmt] = useState('40');
  const [fechaApertura, setFechaApertura] = useState(() => new Date().toISOString().slice(0, 10));

  const rifResultado = useMemo(() => (datos.rif.trim() === '' ? null : validarRif(datos.rif)), [datos.rif]);
  const diferencia = useMemo(() => calcularDiferenciaVes(renglones, capitalVes), [renglones, capitalVes]);

  const set = <K extends keyof DatosEmpresaInput>(k: K, v: DatosEmpresaInput[K]) =>
    setDatos((d) => ({ ...d, [k]: v }));

  const setRenglon = (key: string, campo: keyof RenglonAperturaInput, valor: string) =>
    setRenglones((rs) => rs.map((r) => (r.key === key ? { ...r, [campo]: valor } : r)));

  const irAPerfil = async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await onboardingApi.inferirPerfil(datos);
      setPerfil(r.perfil);
      setPaso(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo inferir el perfil');
    } finally {
      setCargando(false);
    }
  };

  const crearEmpresa = async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await onboardingApi.crearEmpresa(datos);
      setEmpresa(r);
      setPerfil(r.perfil);
      setPaso(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la empresa');
    } finally {
      setCargando(false);
    }
  };

  const registrarSaldos = async () => {
    if (empresa === null) return;
    setCargando(true);
    setError(null);
    try {
      const limpios: RenglonAperturaInput[] = renglones
        .filter((r) => r.cuenta.trim() !== '' && Number(r.montoOrigen) > 0)
        .map((r): RenglonAperturaInput => {
          const { key, ...rest } = r;
          void key;
          return { ...rest, ...(rest.moneda.toUpperCase() === 'VES' ? { rateBcv: null } : {}) };
        });
      await onboardingApi.registrarSaldos(empresa.companyId, {
        fechaApertura,
        capitalVes,
        rateUsdMgmt,
        renglones: limpios,
      });
      setCompanyId(empresa.companyId);
      setPaso(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la apertura');
    } finally {
      setCargando(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Alta de empresa</h1>
        <p className="text-sm text-muted-foreground">Paso {paso} de 5 · meta: facturando en menos de 30 minutos.</p>
      </header>

      {paso === 1 && (
        <section className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="rif">
            RIF
          </label>
          <Input id="rif" value={datos.rif} onChange={(e) => set('rif', e.target.value)} placeholder="J-12345678-9" />
          <RifFeedback resultado={rifResultado} />
          <label className="text-sm font-medium" htmlFor="razon">
            Razón social
          </label>
          <Input id="razon" value={datos.razonSocial} onChange={(e) => set('razonSocial', e.target.value)} />
          <label className="text-sm font-medium" htmlFor="dir">
            Domicilio fiscal
          </label>
          <Input id="dir" value={datos.direccionFiscal ?? ''} onChange={(e) => set('direccionFiscal', e.target.value)} />
          <Button
            className="mt-2"
            disabled={cargando || rifResultado?.valido !== true || datos.razonSocial.trim() === ''}
            onClick={() => void irAPerfil()}
          >
            Continuar
          </Button>
        </section>
      )}

      {paso === 2 && (
        <section className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="tipo">
            Tipo de contribuyente
          </label>
          <select
            id="tipo"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={datos.tipoContribuyente}
            onChange={(e) => set('tipoContribuyente', e.target.value as DatosEmpresaInput['tipoContribuyente'])}
          >
            <option value="ORDINARIO">Ordinario</option>
            <option value="FORMAL">Formal (solo exentas)</option>
            <option value="ESPECIAL">Sujeto pasivo especial (SPE)</option>
          </select>

          <label className="text-sm font-medium" htmlFor="forma">
            Forma jurídica
          </label>
          <select
            id="forma"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            value={datos.formaJuridica}
            onChange={(e) => set('formaJuridica', e.target.value as DatosEmpresaInput['formaJuridica'])}
          >
            <option value="PJ">Persona jurídica</option>
            <option value="PN">Persona natural</option>
          </select>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="ejercicio">
                Inicio ejercicio (mes)
              </label>
              <Input
                id="ejercicio"
                type="number"
                min={1}
                max={12}
                value={datos.ejercicioFiscalInicio ?? 1}
                onChange={(e) => set('ejercicioFiscalInicio', Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="riesgo">
                Riesgo IVSS
              </label>
              <select
                id="riesgo"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={datos.riesgoIvss ?? ''}
                onChange={(e) => set('riesgoIvss', (e.target.value || null) as DatosEmpresaInput['riesgoIvss'])}
              >
                <option value="">—</option>
                {RIESGOS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {perfil !== null && (
            <ul className="rounded-md border border-input p-3 text-sm">
              <li>IVA: {perfil.cobraIva ? `sí (${perfil.periodicidadIva === 'CALENDARIO_SPE' ? 'calendario SPE' : 'mensual'})` : 'no cobra'}</li>
              <li>Agente de retención: IVA {perfil.esAgenteRetencionIva ? '✓' : '—'} · ISLR {perfil.esAgenteRetencionIslr ? '✓' : '—'}</li>
              <li>Percibe IGTF: {perfil.percibeIgtf ? '✓' : '—'}</li>
              <li>Excluido de ajuste por inflación: {perfil.excluidoAjusteInflacion ? '✓' : '—'}</li>
              {perfil.alicuotaIslrPj !== null && <li>ISLR personas jurídicas: {perfil.alicuotaIslrPj}%</li>}
            </ul>
          )}

          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={() => setPaso(1)} disabled={cargando}>
              Atrás
            </Button>
            <Button onClick={() => void irAPerfil()} variant="outline" disabled={cargando}>
              Recalcular perfil
            </Button>
            <Button onClick={() => void crearEmpresa()} disabled={cargando}>
              {cargando ? 'Creando…' : 'Crear empresa y precargar'}
            </Button>
          </div>
        </section>
      )}

      {paso === 3 && empresa !== null && (
        <section className="flex flex-col gap-3">
          <p className="text-sm">
            Empresa {empresa.creada ? 'creada' : 'ya existente'} y configuración precargada:
          </p>
          <ul className="rounded-md border border-input p-3 text-sm">
            <li>Plan de cuentas: {empresa.precarga.cuentas} cuentas</li>
            <li>Almacenes: {empresa.precarga.almacenes}</li>
            <li>Métodos de pago: {empresa.precarga.metodosPago}</li>
            <li>Series de documentos: {empresa.precarga.series}</li>
            <li>Plantillas de contabilización: {empresa.precarga.plantillas}</li>
            <li>Período abierto: {empresa.precarga.periodos}</li>
          </ul>
          <Button className="mt-2" onClick={() => setPaso(4)}>
            Cargar saldos iniciales
          </Button>
        </section>
      )}

      {paso === 4 && (
        <section className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="fecha">
                Fecha de apertura
              </label>
              <Input id="fecha" type="date" value={fechaApertura} onChange={(e) => setFechaApertura(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="capital">
                Capital (VES)
              </label>
              <Input id="capital" value={capitalVes} onChange={(e) => setCapitalVes(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="rate">
                Tasa gerencial Bs/USD
              </label>
              <Input id="rate" value={rateUsdMgmt} onChange={(e) => setRateUsdMgmt(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {renglones.map((r) => (
              <div key={r.key} className="grid grid-cols-12 items-center gap-2">
                <select
                  className="col-span-2 h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  value={r.naturaleza}
                  onChange={(e) => setRenglon(r.key, 'naturaleza', e.target.value)}
                >
                  <option value="ACTIVO">Activo</option>
                  <option value="PASIVO">Pasivo</option>
                </select>
                <Input
                  className="col-span-3"
                  placeholder="Cuenta (1.1.01)"
                  value={r.cuenta}
                  onChange={(e) => setRenglon(r.key, 'cuenta', e.target.value)}
                />
                <Input
                  className="col-span-2"
                  placeholder="Moneda"
                  value={r.moneda}
                  onChange={(e) => setRenglon(r.key, 'moneda', e.target.value.toUpperCase())}
                />
                <Input
                  className="col-span-2"
                  placeholder="Monto"
                  value={r.montoOrigen}
                  onChange={(e) => setRenglon(r.key, 'montoOrigen', e.target.value)}
                />
                <Input
                  className="col-span-2"
                  placeholder="Tasa BCV"
                  value={r.rateBcv ?? ''}
                  disabled={r.moneda.toUpperCase() === 'VES'}
                  onChange={(e) => setRenglon(r.key, 'rateBcv', e.target.value)}
                />
                <button
                  type="button"
                  className="col-span-1 text-sm text-destructive"
                  onClick={() => setRenglones((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                  aria-label="Quitar renglón"
                >
                  ✕
                </button>
              </div>
            ))}
            <Button variant="outline" className="self-start" onClick={() => setRenglones((rs) => [...rs, nuevoRenglon()])}>
              + Renglón
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            Diferencia a <strong>3.3 Resultados acumulados</strong> (plug):{' '}
            <span className={Math.abs(diferencia) < 0.005 ? 'text-emerald-600' : ''}>
              {diferencia.toFixed(2)} VES
            </span>{' '}
            {diferencia >= 0 ? '(al haber)' : '(al debe)'}
          </p>

          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={() => setPaso(3)} disabled={cargando}>
              Atrás
            </Button>
            <Button onClick={() => void registrarSaldos()} disabled={cargando}>
              {cargando ? 'Registrando…' : 'Registrar apertura'}
            </Button>
          </div>
        </section>
      )}

      {paso === 5 && (
        <section className="flex flex-col gap-3">
          <p className="text-sm">
            ✅ Apertura registrada. La empresa está lista para operar — su asiento de apertura cuadra en las tres bases
            (VES, USD y origen).
          </p>
          <Button asChild>
            <Link href="/ventas/facturas/nueva">Emitir la primera factura</Link>
          </Button>
        </section>
      )}

      {error !== null && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </main>
  );
}

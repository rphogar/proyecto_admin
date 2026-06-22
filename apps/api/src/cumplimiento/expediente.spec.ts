import { describe, expect, it } from 'vitest';
import type { DatabaseService } from '../db/database.service';
import { ExpedienteService } from './expediente.service';

/**
 * Expediente técnico de homologación (P17, Providencia 121 §6.3 req. 6). Pruebas con un `db` falso
 * (la versión vigente se lee de product_versions): ensamblado de ficha, arquitectura, informe y
 * serialización descargable. La integración real contra Postgres está en cumplimiento.int.spec.ts.
 */
describe('expediente técnico', () => {
  function servicioCon(versiones: unknown[]): ExpedienteService {
    const db = { select: () => ({ from: () => ({ orderBy: async () => versiones }) }) };
    return new ExpedienteService({ db } as unknown as DatabaseService);
  }

  const fecha = new Date('2026-06-16T00:00:00.000Z');

  it('ensambla ficha, arquitectura, manuales, pruebas de inviolabilidad e informe de cumplimiento', async () => {
    const exp = await servicioCon([]).generar(fecha);
    expect(exp.norma).toMatch(/SNAT\/2024\/000121/);
    expect(exp.ficha.producto).toMatch(/ContaVE/);
    expect(exp.arquitectura.inmutabilidad.length).toBeGreaterThan(0);
    expect(exp.arquitectura.multiTenancy.length).toBeGreaterThan(0);
    expect(exp.manuales.length).toBeGreaterThan(0);
    expect(exp.manuales.every((m) => m.secciones.length > 0)).toBe(true);
    expect(exp.pruebasInviolabilidad.length).toBeGreaterThan(0);
    expect(exp.pendientesNoSoftware.length).toBeGreaterThan(0);
    expect(exp.cumplimiento.requisitos).toHaveLength(6);
  });

  it('sin versiones registradas, versionVigente es null', async () => {
    const exp = await servicioCon([]).generar(fecha);
    expect(exp.ficha.versionVigente).toBeNull();
  });

  it('prefiere la versión HOMOLOGADA como vigente', async () => {
    const versiones = [
      { version: '0.2.0', estadoHomologacion: 'DESARROLLO' },
      { version: '0.1.0', estadoHomologacion: 'HOMOLOGADA' },
    ];
    const exp = await servicioCon(versiones).generar(fecha);
    expect(exp.ficha.versionVigente?.version).toBe('0.1.0');
  });

  it('exporta un JSON descargable con nombre fechado', async () => {
    const { buffer, filename } = await servicioCon([]).exportar(fecha);
    expect(filename).toBe('expediente-tecnico-providencia-121-2026-06-16.json');
    const parsed = JSON.parse(buffer.toString('utf8'));
    expect(parsed.cumplimiento.requisitos).toHaveLength(6);
    expect(parsed.manuales.length).toBeGreaterThan(0);
    expect(parsed.pruebasInviolabilidad.length).toBeGreaterThan(0);
    expect(parsed.pendientesNoSoftware.length).toBeGreaterThan(0);
  });
});

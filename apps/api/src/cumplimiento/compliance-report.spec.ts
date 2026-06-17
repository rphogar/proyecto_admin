import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { informeCumplimiento } from './compliance-report';

/**
 * Informe de cumplimiento de la Providencia 121 (P17). Verifica que cubra los 6 requisitos de §6.3 y
 * —clave— que TODO archivo de implementación y test referenciado exista en el repo, para que el
 * informe no se desactualice silenciosamente (es el insumo del expediente de homologación).
 */
describe('informe de cumplimiento Providencia 121', () => {
  const repoRoot = resolve(__dirname, '../../../..');
  const informe = informeCumplimiento(new Date('2026-06-16T00:00:00.000Z'));

  it('cubre los 6 requisitos técnicos de §6.3', () => {
    const ids = informe.requisitos.map((r) => r.id).sort();
    expect(ids).toEqual(['6.3.1', '6.3.2', '6.3.3', '6.3.4', '6.3.5', '6.3.6']);
  });

  it('el resumen cuadra con los estados de los requisitos', () => {
    const { resumen, requisitos } = informe;
    expect(resumen.total).toBe(requisitos.length);
    expect(resumen.implementado + resumen.parcial + resumen.pendiente).toBe(resumen.total);
    expect(resumen.implementado).toBe(requisitos.filter((r) => r.estado === 'IMPLEMENTADO').length);
  });

  it('cada requisito declara implementación y al menos un test', () => {
    for (const r of informe.requisitos) {
      expect(r.archivos.length, `requisito ${r.id} sin archivos`).toBeGreaterThan(0);
      expect(r.tests.length, `requisito ${r.id} sin tests`).toBeGreaterThan(0);
    }
  });

  it('todos los archivos de implementación referenciados existen', () => {
    for (const r of informe.requisitos) {
      for (const archivo of r.archivos) {
        expect(existsSync(resolve(repoRoot, archivo)), `falta ${archivo} (req ${r.id})`).toBe(true);
      }
    }
  });

  it('todos los archivos de test referenciados existen', () => {
    for (const r of informe.requisitos) {
      for (const test of r.tests) {
        expect(existsSync(resolve(repoRoot, test)), `falta test ${test} (req ${r.id})`).toBe(true);
      }
    }
  });
});

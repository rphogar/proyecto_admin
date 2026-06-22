import { describe, expect, it } from 'vitest';
import { type ArchivoArtefacto, huellaArtefacto, verificarReproducibilidad } from './artefacto';

/**
 * Huella reproducible del artefacto de build (P26, Providencia 121 §6.3 req. 5/6). Pruebas de pureza:
 * determinismo, independencia del orden de enumeración (reproducibilidad), detección de un byte
 * alterado (binario manipulado) y la verificación de reproducibilidad entre dos builds.
 */
describe('huella del artefacto de build', () => {
  const build: ArchivoArtefacto[] = [
    { ruta: 'dist/main.js', contenido: 'console.log("contave");' },
    { ruta: 'dist/app.module.js', contenido: Buffer.from('export class AppModule {}') },
    { ruta: 'package.json', contenido: '{"name":"@contave/api"}' },
  ];

  it('es determinista: el mismo build da la misma huella', () => {
    expect(huellaArtefacto(build)).toBe(huellaArtefacto(build));
  });

  it('es independiente del orden de enumeración (reproducibilidad)', () => {
    const desordenado = [build[2]!, build[0]!, build[1]!];
    expect(huellaArtefacto(desordenado)).toBe(huellaArtefacto(build));
  });

  it('cambiar un solo byte de un archivo cambia la huella (detección de binario alterado)', () => {
    const alterado = build.map((a) => (a.ruta === 'dist/main.js' ? { ...a, contenido: 'console.log("contavE");' } : a));
    expect(huellaArtefacto(alterado)).not.toBe(huellaArtefacto(build));
  });

  it('renombrar un archivo (misma data) cambia la huella (la ruta es parte de la huella)', () => {
    const renombrado = build.map((a) => (a.ruta === 'dist/main.js' ? { ...a, ruta: 'dist/index.js' } : a));
    expect(huellaArtefacto(renombrado)).not.toBe(huellaArtefacto(build));
  });

  it('produce un sha256 hex', () => {
    expect(huellaArtefacto(build)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rechaza rutas duplicadas en el artefacto', () => {
    expect(() => huellaArtefacto([build[0]!, { ...build[0]! }])).toThrow(/duplicada/i);
  });

  it('verificarReproducibilidad: true si coinciden, false si difieren o están vacías', () => {
    const h = huellaArtefacto(build);
    expect(verificarReproducibilidad(h, h)).toBe(true);
    expect(verificarReproducibilidad(h, huellaArtefacto(build.slice(1)))).toBe(false);
    expect(verificarReproducibilidad('', '')).toBe(false);
  });
});

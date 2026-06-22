import '../load-env';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import postgres from 'postgres';
import { type ArchivoArtefacto, huellaArtefacto, verificarReproducibilidad } from './artefacto';

/**
 * Flujo del PROVEEDOR para solicitar la homologación de una versión (P26, Providencia 121 §6.3 req. 6:
 * "cada nueva versión del sistema requiere nueva homologación"). Calcula el **hash del artefacto** del
 * build homologado (`dist/`), verifica su **reproducibilidad** (la huella recomputa idéntica) y pasa la
 * fila de `product_versions` de `DESARROLLO` a `SOLICITADA` registrando ese hash.
 *
 * Es una operación del proveedor, NO un endpoint de tenant: `product_versions` es catálogo global y el
 * rol de aplicación sólo tiene SELECT (migración 0055). Por eso este script conecta como OWNER
 * (`DATABASE_URL`). El hash registrado permite al SENIAT contrastar el binario en producción contra el
 * homologado (inviolabilidad del artefacto, req. 5).
 *
 * Uso: `pnpm --filter @contave/api build` y luego
 *      `pnpm --filter @contave/api homologacion:solicitar -- --version 0.1.0 [--dist dist]`.
 */

/** Enumera recursivamente los archivos de un directorio como entradas de artefacto (rutas posix). */
export function enumerarArtefacto(dir: string, raiz: string = dir): ArchivoArtefacto[] {
  const archivos: ArchivoArtefacto[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      archivos.push(...enumerarArtefacto(ruta, raiz));
    } else if (entrada.isFile()) {
      archivos.push({ ruta: relative(raiz, ruta).split(sep).join('/'), contenido: readFileSync(ruta) });
    }
  }
  return archivos;
}

export interface ResultadoSolicitud {
  hashArtefacto: string;
  /** El build es reproducible: la huella recomputa idéntica (determinismo verificado). */
  reproducible: boolean;
  /** Nº de archivos del artefacto considerados en la huella. */
  archivos: number;
}

/**
 * Prepara la solicitud a partir de los archivos del artefacto ya enumerados (puro, testeable): computa
 * la huella dos veces y verifica que coincidan (reproducibilidad). Separa la lógica de la lectura de
 * disco para poder ejercitarla sin FS.
 */
export function prepararSolicitud(archivos: readonly ArchivoArtefacto[]): ResultadoSolicitud {
  if (archivos.length === 0) throw new Error('Artefacto vacío: ¿se ejecutó el build antes de solicitar la homologación?');
  const primera = huellaArtefacto(archivos);
  const segunda = huellaArtefacto(archivos);
  return { hashArtefacto: primera, reproducible: verificarReproducibilidad(primera, segunda), archivos: archivos.length };
}

function leerArg(nombre: string, porDefecto?: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : porDefecto;
}

async function main(): Promise<void> {
  const version = leerArg('version');
  const dist = leerArg('dist', 'dist')!;
  if (!version) throw new Error('Falta --version (ej: --version 0.1.0)');

  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error('Falta DATABASE_URL (conexión owner para actualizar product_versions)');

  const { hashArtefacto: hash, reproducible, archivos } = prepararSolicitud(enumerarArtefacto(dist));
  console.log(`Artefacto: ${archivos} archivos en ${dist}/ → hash ${hash}`);
  if (!reproducible) throw new Error('El artefacto no es reproducible: la huella no recomputa idéntica');
  console.log('Reproducibilidad verificada (la huella recomputa idéntica).');

  const sql = postgres(ownerUrl, { max: 1 });
  try {
    // Sólo transiciona desde DESARROLLO (guardado e idempotente): no re-solicita versiones ya en
    // trámite/homologadas. El rol app no puede hacer esto (sólo SELECT); aquí se actúa como owner.
    const filas = await sql`
      UPDATE "product_versions"
         SET "estado_homologacion" = 'SOLICITADA', "hash_artefacto" = ${hash}
       WHERE "version" = ${version} AND "estado_homologacion" = 'DESARROLLO'
      RETURNING "version", "estado_homologacion", "hash_artefacto"`;
    if (filas.length === 0) {
      throw new Error(`No se actualizó la versión ${version}: ¿no existe o no está en DESARROLLO?`);
    }
    console.log(`Versión ${version} → SOLICITADA con hash de artefacto registrado.`);
  } finally {
    await sql.end();
  }
}

// Sólo ejecuta como script (no al importar desde los tests).
if (process.argv[1] && process.argv[1].includes('solicitar-homologacion')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

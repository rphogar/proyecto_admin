import { Decimal } from '@contave/shared';
import type { MonedaBcv, TasaBcvCapturada } from './fuente-bcv';

/**
 * Parser del HTML del BCV (https://www.bcv.org.ve). La página publica cada divisa en un bloque
 * `<div id="dolar">…<strong> 36,87340000 </strong></div>` (y `id="euro"`), con el número en
 * formato venezolano (coma decimal, hasta 8 decimales). Aislamos el parsing aquí para testearlo
 * contra un fixture y que la fuente HTTP solo aporte el `fetch`.
 *
 * Sin dependencias de DOM (regex acotado al bloque del id): determinista y liviano.
 *
 * // TODO: validar los `id`/marcado exactos contra la página real del BCV cuando haya acceso de
 * // red en CI; si el BCV cambia el marcado, este parser se versiona (no afecta tasas ya capturadas).
 */

const ID_POR_MONEDA: Record<MonedaBcv, string> = { USD: 'dolar', EUR: 'euro' };

/** Convierte "36.870,12345678" o "36,87340000" (formato VE) a Decimal-string canónico. */
export function normalizarNumeroVe(texto: string): string {
  const limpio = texto.trim().replace(/\s+/g, '');
  // Quita separadores de miles '.' y usa '.' como separador decimal (la ',').
  const normalizado = limpio.replace(/\./g, '').replace(',', '.');
  const d = new Decimal(normalizado);
  if (!d.isFinite() || d.lte(0)) {
    throw new Error(`Tasa BCV ilegible o no positiva: "${texto}"`);
  }
  return d.toFixed(); // Decimal-string sin notación científica.
}

/** Extrae la fecha de valor (`<span ...>Fecha Valor: Lunes, 09 Junio  2026</span>`) si está. */
function extraerPublishedAt(html: string): Date | null {
  const m = /Fecha\s+Valor[^0-9]*(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{4})/i.exec(html);
  if (m === null) return null;
  const [, dia, nombreMes, anio] = m;
  if (dia === undefined || nombreMes === undefined || anio === undefined) return null;
  const meses: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  };
  const mes = meses[nombreMes.toLowerCase()];
  if (mes === undefined) return null;
  // Fecha civil de Caracas (UTC−4) a mediodía para evitar bordes de día.
  return new Date(Date.UTC(Number(anio), mes, Number(dia), 16, 0, 0));
}

function extraerTasaDeBloque(html: string, idMoneda: string): string | null {
  // Desde id="<moneda>" hasta el PRIMER <strong>…</strong> (donde el BCV pone la tasa). No se corta
  // en el primer </div>: el marcado actual cierra el div de la etiqueta (USD/EUR) ANTES del número,
  // y el <strong> trae atributos (`class="strong-tb"`). Dentro del <strong>, el primer número con coma.
  const bloque = new RegExp(`id=["']${idMoneda}["'][\\s\\S]*?<strong[^>]*>([\\s\\S]*?)<\\/strong>`, 'i').exec(
    html,
  );
  const interiorStrong = bloque?.[1];
  if (interiorStrong === undefined) return null;
  const num = /(\d{1,3}(?:\.\d{3})*,\d+|\d+,\d+)/.exec(interiorStrong);
  if (num === null) return null;
  return normalizarNumeroVe(num[0]);
}

/** Parsea el HTML del BCV a las tasas presentes (USD y/o EUR). Lanza si no encuentra ninguna. */
export function parsearTasasBcv(html: string): readonly TasaBcvCapturada[] {
  const publishedAt = extraerPublishedAt(html);
  const tasas: TasaBcvCapturada[] = [];
  for (const moneda of ['USD', 'EUR'] as const) {
    const rate = extraerTasaDeBloque(html, ID_POR_MONEDA[moneda]);
    if (rate !== null) tasas.push({ moneda, rate, publishedAt });
  }
  if (tasas.length === 0) {
    throw new Error('No se pudo extraer ninguna tasa del HTML del BCV');
  }
  return tasas;
}

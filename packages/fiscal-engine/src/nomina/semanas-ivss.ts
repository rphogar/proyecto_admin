/**
 * Semanas cotizables del IVSS en un mes (docs/04 §3; caso 49). El IVSS cotiza por SEMANAS que
 * empiezan el lunes; un mes tiene 4 o 5 lunes. La cuenta es independiente de la zona horaria
 * (depende solo de qué día de la semana cae cada fecha civil 1..n del mes), por lo que se computa
 * con fechas UTC sin riesgo de corrimiento por Caracas.
 *
 * @param anio año (p.ej. 2024)
 * @param mes mes 1–12
 * @returns número de lunes (= semanas cotizables) del mes
 */
export function semanasCotizablesDelMes(anio: number, mes: number): number {
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error(`semanasCotizablesDelMes: fecha inválida ${anio}-${mes}`);
  }
  const diasEnMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  let lunes = 0;
  for (let d = 1; d <= diasEnMes; d += 1) {
    // getUTCDay: 0=domingo, 1=lunes…
    if (new Date(Date.UTC(anio, mes - 1, d)).getUTCDay() === 1) {
      lunes += 1;
    }
  }
  return lunes;
}

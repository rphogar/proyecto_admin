# 07 — Casos Borde (obligatorios en la suite de tests)

Cada caso indica el comportamiento esperado. Los marcados `[GOLDEN]` deben existir como golden tests numéricos en `packages/fiscal-engine/golden/` con valores exactos verificados a mano.

## A. Tasas de cambio y multimoneda

1. **Día sin tasa publicada** (sábado/domingo/feriado bancario): `rateFor()` devuelve la última tasa publicada anterior; el documento registra la fecha de la tasa usada. `[GOLDEN]`
2. **Venta a las 8:00 am antes de que el BCV publique la tasa del día**: rige la última publicada (la del día anterior); si la política de la empresa es "tasa del día", el sistema permite retener el documento en borrador hasta la publicación — configurable, default: última publicada.
3. **Tasa corregida por el BCV** después de usada: la tasa original usada por documentos NO cambia; la nueva fila aplica solo a documentos posteriores; alerta al contador.
4. **Pago mixto**: factura de $100; cliente paga Bs 10.000 (≈$40 a tasa 250) + $60 Zelle. IGTF solo sobre $60 → $1,80. Asiento cuadra en 3 bases; el resto de céntimos va a cuenta de redondeo. `[GOLDEN]`
5. **Vuelto cruzado**: compra de $14,50 pagada con $20 efectivo → vuelto $5,50 o Bs equivalente a tasa del día o mixto; el arqueo de caja refleja el movimiento real por método. `[GOLDEN]`
6. **CxC en USD cobrada semanas después** (tasa subió de 250 a 270): diferencial cambiario ganancia en base VES; en base USD no hay diferencial. Asiento automático correcto en ambas. `[GOLDEN]`
7. **CxP en USD pagada con Bs**: conversión a tasa del día del pago; diferencial pérdida/ganancia simétrico.
8. **Devolución (NC) en divisas a tasa distinta** a la de la factura original: la NC usa la tasa de SU fecha; el neto fiscal por alícuota se calcula correctamente en el libro de ventas del mes de la NC. `[GOLDEN]`
9. **Redondeo extremo**: tasa con 8 decimales × cantidades con 3 decimales → diferencia ≤ Bs 0,01 por documento, ajustada y trazada; jamás descuadra el asiento.
10. **Saldos en USDT** con tasa de mercado ≠ BCV: base fiscal usa BCV del USD (política conservadora, configurable), base gerencial usa valor de mercado; documentar diferencia. `TODO-TRIBUTARISTA`.
11. **Reexpresión mensual de saldos en divisas** con tasa de cierre: asiento reversible el día 1 del mes siguiente; ejecutar dos veces el job NO duplica el ajuste (idempotencia).

## B. IVA y facturación

12. **Factura con líneas gravadas 16%, 8% y exentas**: bases e IVA discriminados por alícuota en documento, libro y planilla; los tres cuadran. `[GOLDEN]`
13. **Prorrata**: mes con ventas gravadas Bs 80.000 y exentas Bs 20.000 → solo 80% del crédito fiscal común es deducible; el 20% restante va al costo/gasto. `[GOLDEN]`
14. **Cambio de alícuota a mitad de mes** (parámetro con vigencia): documentos de cada tramo usan su alícuota; el libro discrimina ambas.
15. **Cliente "consumidor final"**: permitido en ventas al detal; si el monto supera el umbral configurado o el cliente es contribuyente, el sistema exige RIF/CI antes de emitir.
16. **RIF inválido** (dígito verificador no cuadra): bloqueo con explicación; opción de forzar solo con permiso y marca de auditoría.
17. **NC sobre factura de un período YA declarado**: la NC se imputa al período corriente; el sistema muestra el efecto en la próxima declaración y nunca reabre la presentada.
18. **NC parcial** (2 de 5 líneas, o % del total): saldo pendiente de la factura se recalcula; no se puede acreditar más que el saldo.
19. **Anulación el mismo día de una factura no entregada**: estado ANULADA conservando el documento y el número (sin hueco); si ya fue entregada/procesada → solo NC.
20. **Intento de editar factura emitida**: la API rechaza (403 + código de regla); el trigger de DB rechaza aunque alguien salte la API.
21. **Hueco de numeración** detectado (jamás debería ocurrir): alerta crítica al owner + reporte; test de concurrencia: 100 emisiones simultáneas → correlativo perfecto.
22. **Exportación**: alícuota 0%, sin IGTF, libro de ventas columna exportaciones; créditos asociados marcados para recuperación.
23. **Factura en EUR**: doble conversión (EUR→tasa BCV EUR→Bs; gerencial vía USD); todos los reportes consistentes.
24. **Corte de luz a mitad de emisión**: transacción única → o existe todo (número, documento, asiento, evento) o no existe nada.
25. **POS offline**: 10 ventas sin internet → cola local → reconexión → numeración definitiva en orden de sincronización, sin duplicados aunque se reintente (idempotency keys).

## C. Retenciones

26. **Venta a SPE**: cliente retiene 75% del IVA. Factura Bs 1.000 + IVA 160 → cobra Bs 1.040 + comprobante por 120. CxC se salda con efectivo 1.040 + retención 120; la retención pasa a 1.3.02 y se aplica en la declaración del período del comprobante. `[GOLDEN]`
27. **Retención 100%** (proveedor con datos de RIF inconsistentes): motor selecciona 100% según flag del tercero. `[GOLDEN]`
28. **Comprobante de retención recibido tarde** (factura de enero, comprobante llega en marzo): se imputa en el período en que se recibe; control de "facturas a SPE sin comprobante" > 30 días.
29. **Como agente**: compra con factura que no discrimina IVA → retención 100%; factura sin número de control → no deducible + alerta.
30. **Excedente de retenciones** mayor que la cuota: arrastre automático de saldo a períodos siguientes; reporte de excedente acumulado para solicitud de recuperación.
31. **Retención ISLR sobre honorarios a persona natural**: 3% con sustraendo (si la base no supera el umbral, retención 0). `[GOLDEN]`
32. **Pago que mezcla conceptos** (servicio + materiales): retención ISLR solo sobre la porción de servicio si está discriminada; si no, sobre el total — configurable por línea. `TODO-TRIBUTARISTA`.
33. **TXT de retenciones IVA**: formato exacto del portal SENIAT, validado contra archivo de ejemplo real; rechazo del portal = caso de soporte crítico.

## D. IGTF

34. Pago 100% en Bs por transferencia de cliente ordinario → IGTF 0. Pago en USD efectivo a SPE → 3% percibido, asiento a 2.3.05. `[GOLDEN]`
35. **Anticipo en divisas** aplicado después a factura: IGTF se causó al recibir el anticipo, no al facturar; no se duplica.
36. **Devolución de un pago en divisas**: tratamiento del IGTF ya percibido y declarado → NC del IGTF en período corriente. `TODO-TRIBUTARISTA`.

## E. Inventario y costos

37. **Costo promedio con compras en monedas distintas**: compra 10 und a $10 (tasa 250) + 10 und a Bs 3.000 c/u (≈$11,1 a tasa 270) → promedio correcto en AMBAS bases, kardex consistente. `[GOLDEN]`
38. **Venta con stock 0** (backorder): bloqueada por default; si se habilita venta en negativo, el costo usa último promedio y el recosteo posterior ajusta el costo de venta del período abierto únicamente.
39. **Devolución de compra** después de haber vendido parte del lote: recosteo promedio sin romper kardex.
40. **Ajuste de inventario por merma/robo**: requiere motivo + aprobación; gasto no deducible vs deducible según soporte (flag para conciliación fiscal).
41. **Traslado entre almacenes en tránsito** (camión Caracas→Valencia): estado EN_TRÁNSITO, no disponible para venta en ninguno de los dos.

## F. Períodos, cierres y datos históricos

42. **Asiento con fecha en período cerrado**: rechazado; opción "registrar en período abierto con referencia al cerrado".
43. **Reapertura de período**: solo owner+contador, motivo obligatorio, evento de auditoría, re-cierre exige re-correr el wizard.
44. **Empresa que se vuelve SPE a mitad de año**: a partir de la fecha de la providencia cambian calendario, retenciones (pasa a agente), anticipos y exclusión de ajuste por inflación; el sistema versiona el perfil del contribuyente con vigencia.
45. **Migración desde Gálac/Excel**: importadores de saldos iniciales, terceros, ítems y CxC/CxP abiertas; los saldos iniciales se cargan con asiento de apertura balanceado y costo/fecha de origen para reexpresión.
46. **Reconversión monetaria histórica** (datos previos con otros ceros): los importadores normalizan; el sistema solo opera en la escala monetaria vigente.

## G. Nómina

47. **Ingreso el 20 del mes** (quincena del 16–31): prorrateo de días efectivos; cestaticket proporcional según política. `[GOLDEN]`
48. **Salario mixto** Bs 5.000 + $200: incidencias (prestaciones, vacaciones, IVSS con tope en salarios mínimos) sobre el total expresado correctamente a la fecha de cada causación. `[GOLDEN]`
49. **Mes con 5 lunes**: IVSS cotiza 5 semanas. `[GOLDEN]`
50. **Liquidación con 12 años de antigüedad**: doble cálculo art. 142 (garantía+intereses vs 30 días×año al último integral) → paga el mayor; incluir 2 días adicionales/año y anticipos descontados. `[GOLDEN]`
51. **Aumento salarial retroactivo**: recálculo de provisiones del trimestre en curso; nunca toca períodos cerrados (ajuste en el abierto).
52. **Vacaciones que cruzan el cierre de mes** y reposo IVSS desde el día 2 (patrono paga 3 días, IVSS después): distribución correcta del gasto.

## H. Seguridad, concurrencia y operación

53. Dos cajeros emiten al mismo segundo en la misma serie → números distintos consecutivos (test de carrera).
54. Usuario con rol cajero intenta cerrar período / ver salarios → 403 + auditoría.
55. Token de un tenant usado contra datos de otro → 0 filas (RLS) + alerta.
56. Restore de backup en ambiente limpio → invariantes del ledger se cumplen al 100% (drill mensual automatizable).
57. Webhook/job de tasa BCV falla 3 días (feriados largos + caída) → el sistema sigue operando con última tasa y banner de advertencia; al volver, no recalcula documentos emitidos.

# 02 — Normativa Fiscal Venezolana

> ⚠️ **Este documento es la base de requerimientos legales del sistema.** Fue compilado como punto de partida y debe ser validado artículo por artículo por un tributarista antes de producción. Cada norma cita su instrumento; verificar reformas posteriores en Gaceta Oficial. Donde un valor cambia por decreto/providencia (alícuotas, UT, calendarios), el sistema lo modela como **parámetro con vigencia temporal**.

## 0. Mapa normativo (jerarquía)

1. **Constitución** → 2. **Código Orgánico Tributario (COT)**, Decreto Constituyente 2020 — reglas generales: deberes formales, sanciones, prescripción, ilícitos. → 3. **Leyes de cada tributo**: Ley del IVA, Ley de ISLR, Ley del IGTF, Ley de Timbre Fiscal, LOTTT y leyes parafiscales. → 4. **Reglamentos** de cada ley. → 5. **Providencias administrativas del SENIAT** (facturación, retenciones, calendarios, homologación). → 6. **Ordenanzas municipales** (impuesto a las actividades económicas, publicidad, inmuebles).

## 1. Sujetos y clasificación de contribuyentes

El sistema debe clasificar a cada empresa (y a cada cliente/proveedor) según su perfil tributario, porque de ello dependen cálculos, retenciones y calendarios:

| Perfil | Qué es | Consecuencias en el sistema |
|---|---|---|
| **Contribuyente ordinario de IVA** | Vende bienes/servicios gravados | Cobra IVA, declara mensualmente, lleva libros de compras/ventas |
| **Contribuyente formal** | Solo realiza operaciones exentas/exoneradas | No cobra IVA; deberes formales simplificados |
| **Sujeto pasivo especial (SPE / "contribuyente especial")** | Designado por el SENIAT mediante providencia individual | Agente de retención de IVA e ISLR; agente de percepción del IGTF; declara según **calendario especial** (anticipos quincenales/semanales de IVA e ISLR); excluido del ajuste por inflación fiscal |
| **No contribuyente / consumidor final** | Persona natural sin actividad | Solo receptor de facturas |

Campos obligatorios por tercero: RIF (formato `[VEJPG]-XXXXXXXX-X`, con validación de dígito verificador), razón social, domicilio fiscal, condición (ordinario/formal/especial), % de retención de IVA que aplica (75/100), si es agente de retención de ISLR.

## 2. Código Orgánico Tributario (COT) — reglas transversales

- **Deberes formales** (art. 155): inscribirse en registros (RIF), emitir documentos exigidos, llevar libros y registros, presentarlos cuando se requieran, conservarlos durante el lapso de prescripción.
- **Prescripción**: 6 años en general, 10 cuando no se declara o no se inscribe → el sistema conserva todos los registros, documentos y soportes digitalizados **mínimo 10 años** sin posibilidad de purga.
- **Sanciones relevantes que el sistema debe ayudar a evitar** (las multas se expresan en "tipo de cambio oficial de la moneda de mayor valor publicado por el BCV"): no emitir facturas (multa + **clausura del establecimiento**), emitir facturas sin cumplir requisitos, no llevar libros o llevarlos con atraso superior a un mes, no presentar declaraciones o presentarlas tarde, no enterar retenciones (las más graves: hasta penas privativas).
- **Unidad Tributaria (UT)**: valor fijado por el SENIAT; hoy de uso residual (umbral de declaración de naturales, tarifas), las sanciones ya no se expresan en UT. Parámetro con vigencia.

## 3. IVA — Ley del Impuesto al Valor Agregado

### 3.1 Hecho imponible y alícuotas
- Grava venta de bienes muebles, prestación de servicios, importación.
- **Alícuota general: 16%** (rango legal 8%–16,5%, fijada por Ley de Presupuesto).
- **Alícuota reducida: 8%** (ciertos alimentos/bienes; lista en ley).
- **Alícuota adicional bienes/servicios suntuarios: +15%** (total 31%) — joyas, ciertos vehículos, etc.
- **Alícuota adicional por pago en divisas/cripto: entre 5% y 25%** prevista en la reforma de 2020, aplicable solo cuando el Ejecutivo la decrete. **El motor fiscal debe soportarla como parámetro aunque hoy no esté decretada.**
- **Exportaciones: alícuota 0%** (con derecho a recuperación de créditos fiscales).
- Categorías de no causación: **exento** (por ley), **exonerado** (por decreto, temporal — modelar con vigencia), **no sujeto**.

### 3.2 Débito, crédito y cuota
- **Débito fiscal** = IVA cobrado en ventas del período. **Crédito fiscal** = IVA soportado en compras del período vinculadas a la actividad.
- **Cuota a pagar** = débitos − créditos − retenciones de IVA soportadas (acumuladas) − excedentes de períodos anteriores.
- **Prorrata** (art. 34 y ss.): si el contribuyente realiza operaciones gravadas y exentas, solo es deducible el crédito fiscal en proporción a las ventas gravadas / ventas totales. El motor debe calcular la prorrata mensual.
- **Período**: mensual (mes calendario) para ordinarios; los SPE declaran y pagan según calendario especial y además enteran **anticipos** (régimen de anticipos de IVA e ISLR para SPE, sobre los ingresos brutos del período semanal/quincenal según providencia vigente — parametrizable).

### 3.3 Retenciones de IVA — Providencia SNAT/2015/0049
- Los SPE (y entes públicos) retienen al pagar a sus proveedores: **75% del IVA** facturado, regla general; **100%** cuando: el proveedor no está inscrito en RIF o los datos no coinciden, la factura no cumple requisitos, el proveedor está en la lista de "sujetos sin derecho a deducción", o no discrimina el impuesto.
- El agente emite **comprobante de retención de IVA** (numeración propia `AAAAMMNNNNNNNN`), lo entrega al proveedor y entera lo retenido al SENIAT en los plazos del calendario SPE (quincenal).
- Para el **retenido**, el comprobante es un crédito descontable de su cuota de IVA; si no lo puede descontar, se acumula como excedente y eventualmente puede solicitar recuperación.
- El sistema debe manejar ambos roles: **como agente** (calcular, emitir comprobante, archivo TXT/XML de declaración de retenciones según formato SENIAT) y **como sujeto retenido** (registrar comprobantes recibidos, aplicarlos a la declaración, controlar excedentes).

## 4. ISLR — Ley de Impuesto Sobre la Renta

- **Personas jurídicas**: Tarifa N° 2 por tramos en UT: 15% / 22% / **34%** (la mayoría de las PYMEs cae en 34% sobre enriquecimiento neto). Actividades de hidrocarburos: 50% (fuera de alcance v1). Banca/seguros: alícuota proporcional especial.
- **Personas naturales**: Tarifa N° 1 progresiva 6%–34%; declaran si superan el umbral legal (1.000 UT de enriquecimiento o 1.500 UT de ingresos — verificar vigencia).
- **Ejercicio fiscal**: 12 meses; declaración definitiva dentro de los **3 meses** siguientes al cierre. **Declaración estimada** (anticipo) para quienes superan el umbral legal, salvo SPE que ya pagan anticipos.
- **Ajuste por inflación fiscal**: el sistema debe saber que los **SPE están excluidos** del ajuste por inflación (reforma 2015) y los demás contribuyentes siguen el régimen de ajuste inicial y regular (API) — implementar como módulo de cálculo separado en fase tardía, marcado `TODO-TRIBUTARISTA`.
- **Pérdidas fiscales**: trasladables hasta 3 ejercicios, con límite de imputación del 25% del enriquecimiento del ejercicio.
- **Retenciones de ISLR — Decreto 1.808** (Reglamento Parcial en materia de retenciones): los deudores/pagadores (especialmente SPE) retienen en la fuente sobre ciertos pagos. Tabla mínima que el motor debe incluir (parametrizable, con sustraendo para personas naturales residentes):

| Concepto | PN residente | PJ domiciliada |
|---|---|---|
| Honorarios profesionales | 3% (con sustraendo) | 5% |
| Servicios (contratistas/subcontratistas) | 1% | 2% |
| Arrendamiento de inmuebles | 3% | 5% |
| Fletes | 1% | 3% |
| Publicidad | 3% | 5% (medios: 3%) |
| Comisiones | 3% | 5% |
| Intereses | 3% | 5% |

- **Sueldos y salarios**: retención según porcentaje del formulario **ARI** que el trabajador presenta (estimación anual propia); recálculo trimestral. El módulo de nómina debe gestionar ARI por trabajador.
- El agente entrega **comprobante de retención de ISLR**, entera según calendario, y emite el **ARC** anual a cada trabajador/proveedor.

## 5. IGTF — Impuesto a las Grandes Transacciones Financieras (reforma 2022)

- **2%**: débitos bancarios y pagos de los **SPE** en bolívares (cuando aplica según la ley).
- **3%**: pagos en **moneda extranjera o criptomonedas distintas a las emitidas por la República**, sin mediación del sistema bancario nacional, hechos a SPE designados **agentes de percepción**. Rango legal hasta 8%/20% según supuesto — alícuotas parametrizables.
- El SPE que recibe el pago en divisas **percibe** el 3% del cliente, lo refleja en la factura/documento, lo declara y entera según calendario (declaración de IGTF percibido, típicamente quincenal).
- No es deducible del ISLR para quien lo paga (verificar tratamiento vigente) y **no forma parte de la base imponible del IVA**.
- Reglas del motor: el IGTF se calcula **sobre la porción pagada en divisas** (pagos mixtos → solo la parte en USD/USDT genera IGTF); se causa al momento del **pago**, no de la emisión de la factura; debe poder emitirse en el mismo documento o en documento separado según configuración.

## 6. Facturación — el corazón regulatorio

### 6.1 Providencia SNAT/2011/00071 (régimen general, vigente como base)
- **Medios de emisión**: (a) formatos elaborados por **imprentas autorizadas**, (b) **formas libres** elaboradas por imprentas autorizadas (el sistema imprime los datos sobre la forma con número de control preimpreso), (c) **máquinas fiscales** (impresoras con memoria fiscal inviolable y dispositivo de seguridad, de marcas/modelos autorizados).
- **Obligados a máquina fiscal**: contribuyentes con ingresos superiores al umbral (1.500 UT) que realicen ventas a consumidores finales en actividades listadas (comercio al detal, restaurantes, farmacias, etc.). El sistema debe poder **comandar impresoras fiscales** (protocolos de los fabricantes autorizados: The Factory HKA, Bematech, etc.) cuando el cliente esté obligado.
- **Requisitos mínimos de la factura** (el generador de documentos debe validarlos TODOS antes de emitir): denominación "FACTURA"; **numeración consecutiva y única**; **número de control** preimpreso (formatos/formas libres); nombre/razón social, RIF y domicilio fiscal del emisor; fecha de emisión; identificación del adquirente (nombre y RIF/CI — obligatorio para contribuyentes; "consumidor final" permitido en ventas al detal bajo umbral); descripción de bienes/servicios con cantidad y precio; indicación de descuentos; base imponible discriminada por alícuota; **IVA discriminado por alícuota**; total; moneda (si se expresa en divisas: **debe indicar el equivalente en bolívares y la tasa de cambio BCV aplicada**); condición de pago (contado/crédito).
- **Notas de crédito y débito**: únicos medios para corregir/anular una factura emitida y entregada; deben referenciar número, fecha y monto de la factura afectada. Anulación directa solo si el documento no fue entregado/procesado (conservando el original anulado).
- **Guías de despacho**: amparan traslado de mercancía no vendida o previa a facturación.

### 6.2 Providencia SNAT/2024/000102 — Facturación digital (G.O. 43.032, 19-dic-2024)
- Crea el régimen de **emisión de facturas y documentos fiscales por medios digitales** y la figura de la **imprenta digital autorizada** (asigna números de control digitales).
- Obligatoria para ventas por **medios electrónicos** (e-commerce, redes sociales, plataformas); aplicación general escalonada desde marzo 2025, con consolidación y fiscalización durante 2026.
- "Factura digital" ≠ "factura electrónica con validación en línea del SENIAT" (esta última aún no implementada; la arquitectura debe dejar el camino preparado).
- El documento digital conserva TODOS los requisitos de la 00071 + elementos de control digital; se entrega por correo u otro medio electrónico; se conserva digitalmente a disposición del SENIAT (mínimo 5 años por esta norma; el sistema usa 10 por COT).

### 6.3 Providencia SNAT/2024/000121 — Homologación de sistemas (G.O. 43.032, 19-dic-2024)
**Esta norma define requisitos de arquitectura del producto.** Los proveedores de sistemas informáticos de facturación deben estar **autorizados y homologados por el SENIAT**; los contribuyentes solo pueden usar sistemas homologados (plazo de adaptación de 90 días desde su entrada en vigencia; hoy plenamente exigible).

Requisitos técnicos que el sistema DEBE cumplir desde el diseño:
1. Garantizar **integridad, continuidad, confiabilidad, conservación, accesibilidad, legibilidad, trazabilidad, inalterabilidad e inviolabilidad** de los registros.
2. **Remisión por medios electrónicos al SENIAT, de forma continua, segura, correcta, íntegra, automática, consecutiva, inmediata y fehaciente** de los registros de facturación que requiera → diseñar un módulo de "remisión fiscal" desacoplado (cola + reintentos + acuse), activable cuando el SENIAT publique el canal técnico.
3. **Registro automático de eventos** (event log inmutable): toda interacción/operación con el sistema, fechada con fecha y hora.
4. **Corrección o anulación de facturas únicamente mediante notas de débito o crédito**, conservando inalterables los datos originales.
5. Impedir conexión de equipos no fiscales / desvío de contabilidad paralela; el proveedor responde por alteraciones.
6. Proceso: solicitud con ficha técnica, manuales y documentos legales → evaluación técnica del SENIAT → informe vinculante → acto administrativo en 15 días hábiles. **Cada nueva versión del sistema requiere nueva homologación** → mantener versionado formal del producto y un "expediente de homologación" actualizado.

## 7. Libros y registros obligatorios

### 7.1 Libros legales (Código de Comercio, arts. 32 y ss.)
- **Libro Diario**, **Libro Mayor**, **Libro de Inventarios**. Sellados/registrados; en la práctica moderna se imprimen desde el sistema. Sin atraso mayor a un mes (sanción COT).
- Sociedades: libros de actas y de accionistas (fuera de alcance del sistema; solo recordatorios).

### 7.2 Libros especiales de IVA (Reglamento de la Ley de IVA, arts. 70–78)
- **Libro de Compras** y **Libro de Ventas**, cronológicos, sin atraso. Columnas mínimas que el reporte debe generar exactamente: fecha; RIF y nombre del proveedor/cliente; número de factura, de control, de nota de débito/crédito, del comprobante de retención; tipo de operación (interna/importación/exportación); monto total; base imponible separada **por alícuota**; IVA por alícuota; compras/ventas exentas, exoneradas y no sujetas; IVA retenido. Resumen mensual con totales que cuadren con la declaración.
- Exportar en PDF (formato legal imprimible) y Excel.

## 8. Tributos municipales y otros

- **Impuesto a las Actividades Económicas (ISAE / "patente")**: ordenanza por municipio; alícuota según **clasificador de actividades** (típicamente 0,5%–3% sobre **ingresos brutos**), con mínimo tributable; declaración y anticipos según ordenanza (mensual o trimestral en la mayoría). El sistema modela: municipio(s) donde opera la empresa, código(s) de actividad, alícuota(s), y genera la base de ingresos brutos por municipio/sucursal. Multi-sede = declaración en cada municipio.
- **Timbres fiscales** estadales, **impuesto inmobiliario**, **publicidad comercial**: solo recordatorios de calendario en v1.
- **Ley de Registro y Notariado**: tasas en "moneda de mayor valor" — relevante solo para costos.

## 9. Régimen cambiario y moneda de registro

- **Convenio Cambiario N° 1 (2018)**: libre convertibilidad; la contabilidad y los estados financieros se llevan **en bolívares**; las operaciones en moneda extranjera se registran al **tipo de cambio de referencia BCV** vigente a la fecha de la operación.
- **Art. 128–130 Ley del BCV**: los pagos en moneda extranjera se liquidan al tipo de cambio corriente salvo cláusula expresa de pago efectivo en divisa (relevante para contratos y nómina en divisas).
- La factura puede **expresarse en divisas** pero debe mostrar el contravalor en Bs a tasa BCV del día de emisión; el IVA se entera en Bs.
- **Fuente de tasas**: publicación diaria del BCV (USD, EUR, etc.). Días sin publicación (fines de semana, feriados bancarios) → rige la **última tasa publicada**. El sistema almacena la serie histórica completa con fuente y hora de captura.

## 10. Calendario de obligaciones (motor de calendario)

El sistema incluye un **motor de calendario fiscal** parametrizable que genera las obligaciones de cada empresa según su perfil. Estructura mínima:

| Obligación | Ordinario | SPE |
|---|---|---|
| Declaración y pago IVA | Mensual, primeros 15 días continuos del mes siguiente | Según calendario SPE (por terminal de RIF) |
| Retenciones IVA (enterar) | n/a | Quincenal, calendario SPE |
| Anticipos IVA/ISLR | n/a | Semanal/quincenal según providencia vigente |
| Retenciones ISLR (enterar) | Primeros 10 días del mes siguiente (verificar) | Calendario SPE |
| IGTF percibido | n/a (salvo designación) | Calendario SPE |
| ISLR definitiva | 3 meses tras cierre del ejercicio | Igual, fechas del calendario |
| ISLR estimada | Según reglamento (mes 6 del ejercicio) | Sustituida por anticipos |
| ISAE municipal | Según ordenanza | Según ordenanza |
| Parafiscales (IVSS, FAOV, INCES, RPE) | Mensual/trimestral — ver doc 04 | Igual |

El **calendario SPE se publica anualmente por providencia** (organizado por último dígito del RIF) → importarlo cada año como datos, nunca como código.

## 11. Reglas duras derivadas (resumen para el motor fiscal)

1. Toda factura valida los requisitos 00071/00102 antes de emitirse; si falla un requisito, no se emite.
2. Numeración consecutiva sin huecos por serie y sucursal; número de control gestionado según medio de emisión.
3. Documento emitido = inmutable; correcciones solo por NC/ND con referencia cruzada.
4. IVA discriminado por alícuota en documento y libros; prorrata cuando hay ventas exentas.
5. IGTF se causa al pago y solo sobre la porción en divisas; 3% percepción si la empresa es SPE designada.
6. Retención de IVA 75/100% según condición del proveedor; comprobante con numeración normada; TXT de declaración según especificación SENIAT.
7. Retención de ISLR por concepto de pago según tabla 1.808; sustraendo para naturales; ARC anual.
8. Libros de compras/ventas generados desde los mismos registros que la declaración: **una sola fuente de verdad** — si el libro no cuadra con la planilla, hay un bug.
9. Registro contable en Bs a tasa BCV de la fecha de operación; serie de tasas histórica inviolable.
10. Conservación de todo: 10 años, sin purga.

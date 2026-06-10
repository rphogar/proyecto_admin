# 04 — Nómina y Normativa Laboral (LOTTT y parafiscales)

> ⚠️ Salario mínimo, cestaticket, "bonos" gubernamentales y topes cambian por decreto con frecuencia: **todo valor es parámetro con vigencia**. Validar cálculos con un especialista laboral antes de producción.

## 1. Conceptos de salario (LOTTT)

| Concepto | Definición | Uso en cálculos |
|---|---|---|
| **Salario normal** | Remuneración regular y permanente (sin utilidades, bono vacacional ni percepciones accidentales) | Base de vacaciones, bono vacacional, IVSS/RPE, retención ISLR |
| **Salario integral** | Salario normal + alícuotas de utilidades y bono vacacional | Base de prestaciones sociales e indemnizaciones |
| **Alícuota de utilidades** | (días de utilidades/360) × salario diario | Componente del integral |
| **Alícuota de bono vacacional** | (días de bono/360) × salario diario | Componente del integral |
| Percepciones **no salariales** | Cestaticket, ciertos beneficios sociales (art. 105) | No inciden en prestaciones ni parafiscales |

**Salario en divisas**: práctica extendida; jurisprudencia admite pacto en divisas (pago en divisa o su equivalente en Bs a tasa BCV del pago salvo cláusula de pago efectivo). El sistema debe soportar salario pactado en USD con liquidación mixta, y calcular TODAS las incidencias (prestaciones, vacaciones, utilidades, parafiscales) sobre el equivalente correcto a la fecha de cada causación. `TODO-TRIBUTARISTA/LABORAL: confirmar base de cotización IVSS para salario en divisas (tope en salarios mínimos)`.

## 2. Beneficios y acumulados que el módulo calcula

### 2.1 Vacaciones y bono vacacional (arts. 190, 192)
- Vacaciones: **15 días hábiles** el primer año **+ 1 día adicional por año** de servicio (hasta 15 adicionales).
- Bono vacacional: **15 días de salario normal + 1 día por año** (hasta 30). Se paga al salir de vacaciones.
- Provisión mensual automática (1/12) contra pasivo 2.4.05.

### 2.2 Utilidades (art. 131)
- Mínimo **30 días** de salario, máximo **120 días** (4 meses), según beneficios de la empresa; pagaderas en los primeros 15 días de diciembre (anticipo) con ajuste al cierre.
- Parámetro `dias_utilidades` por empresa; provisión mensual 1/12.

### 2.3 Prestaciones sociales (art. 142)
- **Garantía trimestral**: **15 días de salario integral por trimestre** (depositados en fideicomiso, contabilidad de la empresa o FAOV según elección del trabajador) + **2 días adicionales por año** de servicio a partir del segundo año (acumulativos hasta 30).
- **Cálculo retroactivo al término**: 30 días por año de servicio al **último salario integral**; el trabajador recibe **el monto mayor** entre garantía acumulada+intereses y el retroactivo.
- **Intereses sobre prestaciones**: tasa promedio BCV, capitalizables anualmente; pago anual de intereses si el trabajador lo solicita.
- **Anticipos**: hasta **75%** de lo acumulado, para fines tasados (vivienda, salud, educación).
- **Indemnización por despido injustificado (art. 92)**: monto igual a las prestaciones (el "doblete").
- El sistema lleva el **kardex de prestaciones por trabajador**: depósitos trimestrales, días adicionales, intereses, anticipos, y la doble valuación (garantía vs retroactivo) en cada momento.

### 2.4 Cestaticket socialista
- Beneficio de alimentación no salarial; monto fijado por decreto (históricamente indexado; hoy monto en Bs equivalente a referencia USD). Parámetro mensual con vigencia. Sin incidencia salarial.

### 2.5 Otros
- **Preaviso** (renuncia), **horas extras** (recargo 50%, límites legales 10h/semana, 100h/año), **bono nocturno** (30%), **feriados y descansos** (recargo 50% si se laboran), **domingos**, **días feriados nacionales** (tabla parametrizable), **permisos y reposos** (IVSS paga a partir del 4º día — el sistema calcula la porción patrono/IVSS), **licencia pre/postnatal** (6+20 semanas), **inamovilidad** (solo alertas informativas).

## 3. Parafiscales (retenciones al trabajador y aportes patronales)

| Régimen | Trabajador | Patrono | Base | Tope | Enteración |
|---|---|---|---|---|---|
| **IVSS** (seguro social) | 4% | 9% / 10% / 11% según riesgo de la empresa | Salario normal | 5 salarios mínimos | Mensual (TIUNA) |
| **RPE** (régimen prestacional de empleo / "paro forzoso") | 0,5% | 2% | Salario normal | 10 salarios mínimos | Mensual (TIUNA) |
| **FAOV** (vivienda, BANAVIH) | 1% | 2% | **Salario integral** | Sin tope | Mensual (FAOV en línea) |
| **INCES** | 0,5% sobre utilidades pagadas | 2% sobre nómina (empresas con 5+ trabajadores) | Ver columnas | — | Trimestral patrono; anual trabajador |
| **Retención ISLR salarios** | % del ARI | — | Remuneraciones | — | Según calendario |

- Bases semanales/mensuales: IVSS cotiza por **semanas (lunes)** — el sistema calcula semanas cotizables del mes (4 o 5). 
- Generar archivos/planillas de carga para **TIUNA (IVSS)**, **FAOV en línea (BANAVIH)** e **INCES** en los formatos vigentes.
- **LOPCYMAT/INPSASEL**: sin aporte directo de nómina, pero el sistema guarda datos de riesgo y emite constancias.

## 4. Retención de ISLR sobre sueldos (ARI)

1. El trabajador que estima superar el umbral anual (1.000 UT) presenta el **formulario AR-I** con su porcentaje estimado (enero, y revisable en marzo/junio/septiembre/diciembre).
2. El sistema guarda el % vigente por trabajador y lo aplica a cada pago; si el trabajador no presenta AR-I, el patrono determina el porcentaje según el procedimiento reglamentario.
3. Al cierre del año: emisión del **ARC** (comprobante anual de remuneraciones y retenciones) por trabajador.

## 5. Flujo del módulo de nómina

```
Configurar empresa (riesgo IVSS, días de utilidades, períodos de pago)
→ Ficha del trabajador (datos, salario y moneda, fecha de ingreso, ARI, cargas familiares, cuenta de pago)
→ Conceptos (asignaciones/deducciones; fórmulas parametrizables con editor seguro)
→ Pre-nómina del período (quincenal/semanal/mensual) → revisión → aprobación
→ Recibos de pago (PDF firmable, en Bs con equivalente USD si aplica)
→ Asiento contable automático (gasto 6.1, pasivos 2.4.x)
→ Provisiones mensuales automáticas (prestaciones, utilidades, vacaciones, intereses)
→ Planillas parafiscales del período → calendario de enteración
→ Liquidación de trabajador (asistente: prestaciones doble cálculo, vacaciones fraccionadas,
   utilidades fraccionadas, intereses, deducciones, art. 92 si aplica) → finiquito PDF
```

**Edge cases obligatorios en tests**: ingreso/egreso a mitad de período (prorrateos), vacaciones que cruzan meses, salario variable (comisiones → promedio para vacaciones/prestaciones), aumento salarial retroactivo, trabajador con salario mixto Bs+USD, recálculo de prestaciones por aumento, semanas IVSS en meses de 5 lunes, reposo prolongado, doble cálculo garantía vs retroactivo en liquidación con más de 10 años de antigüedad.

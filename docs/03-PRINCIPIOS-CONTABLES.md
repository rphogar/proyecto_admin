# 03 — Principios Contables y Motor Multimoneda

## 1. Partida doble — el invariante fundamental

Toda transacción económica se registra como un **asiento** (`journal_entry`) compuesto por dos o más **líneas** (`journal_lines`), donde cada línea debita o acredita una cuenta. Invariante absoluto:

```
∀ asiento: Σ(débitos) = Σ(créditos)   — en VES, en USD gerencial y en moneda origen
```

Ecuación contable global: `Activos = Pasivos + Patrimonio` (y en el período: `+ Ingresos − Costos − Gastos`).

**Naturaleza de las cuentas** (qué lado las aumenta):

| Tipo | Aumenta por | Disminuye por | Saldo normal |
|---|---|---|---|
| Activo | Débito | Crédito | Deudor |
| Pasivo | Crédito | Débito | Acreedor |
| Patrimonio | Crédito | Débito | Acreedor |
| Ingreso | Crédito | Débito | Acreedor |
| Costo/Gasto | Débito | Crédito | Deudor |

Principios aplicados: **devengo** (se registra cuando ocurre, no cuando se cobra), negocio en marcha, uniformidad, esencia sobre forma, prudencia.

## 2. Plan de cuentas (catálogo base venezolano)

Estructura de código: `C.GG.SS.AAA` (clase, grupo, subgrupo, auxiliar), profundidad configurable. Cuentas de movimiento solo en el último nivel; las superiores son totalizadoras. El sistema se entrega con este catálogo **preconfigurado** (el contador puede extenderlo, no borrar cuentas de sistema con movimientos):

```
1. ACTIVO
 1.1 Efectivo y equivalentes
  1.1.01 Caja Bs · 1.1.02 Caja USD efectivo · 1.1.03 Bancos nacionales Bs (auxiliar por banco)
  1.1.04 Bancos nacionales custodia USD · 1.1.05 Cuentas en el exterior (Zelle/bancos)
  1.1.06 Criptoactivos (USDT y otros) · 1.1.07 Fondos en plataformas (Binance/Zinli/etc.)
 1.2 Cuentas por cobrar
  1.2.01 Clientes Bs · 1.2.02 Clientes divisas · 1.2.03 Estimación incobrables
  1.2.04 Anticipos a proveedores · 1.2.05 Cuentas por cobrar accionistas/relacionadas
 1.3 Impuestos a favor
  1.3.01 IVA crédito fiscal · 1.3.02 Retenciones de IVA soportadas (acumuladas)
  1.3.03 Retenciones de ISLR soportadas · 1.3.04 Excedentes de IVA · 1.3.05 IGTF soportado
 1.4 Inventarios (auxiliar por almacén) · 1.5 Activos fijos y depreciación acumulada · 1.6 Otros activos
2. PASIVO
 2.1 Proveedores (Bs / divisas) · 2.2 Obligaciones financieras
 2.3 Impuestos por pagar
  2.3.01 IVA débito fiscal · 2.3.02 IVA por pagar (cuota) · 2.3.03 Retenciones de IVA por enterar
  2.3.04 Retenciones de ISLR por enterar · 2.3.05 IGTF percibido por enterar
  2.3.06 ISLR por pagar · 2.3.07 ISAE municipal por pagar
 2.4 Pasivos laborales
  2.4.01 Sueldos por pagar · 2.4.02 Prestaciones sociales (garantía) · 2.4.03 Intereses sobre prestaciones
  2.4.04 Utilidades por pagar · 2.4.05 Vacaciones/bono vacacional por pagar
  2.4.06 IVSS/RPE por enterar · 2.4.07 FAOV por enterar · 2.4.08 INCES por enterar · 2.4.09 Retención ISLR salarios
 2.5 Anticipos de clientes
3. PATRIMONIO
 3.1 Capital social · 3.2 Reserva legal (5% utilidad hasta 10% del capital — Código de Comercio)
 3.3 Resultados acumulados · 3.4 Resultado del ejercicio · 3.5 Superávit/ajustes por reexpresión
4. INGRESOS
 4.1 Ventas gravadas 16% · 4.2 Ventas gravadas 8% · 4.3 Ventas exentas/exoneradas
 4.4 Ventas de exportación · 4.5 Devoluciones y descuentos en ventas (contra-ingreso)
 4.6 Otros ingresos · 4.7 Ganancia en diferencial cambiario
5. COSTOS
 5.1 Costo de ventas · 5.2 Compras (si se usa sistema periódico) — default: **inventario permanente**
6. GASTOS
 6.1 Gastos de personal (sueldos, cestaticket, prestaciones, parafiscales — auxiliares)
 6.2 Servicios (alquiler, electricidad, internet, honorarios) · 6.3 Gastos de venta
 6.4 Depreciación · 6.5 Tributos (ISAE, IGTF gasto, timbres) · 6.6 Gastos financieros y comisiones
 6.7 Pérdida en diferencial cambiario · 6.8 Gastos no deducibles (separados para conciliación fiscal ISLR)
```

## 3. VEN-NIF (marco de presentación)

- Emisor: **FCCPV** (Federación de Colegios de Contadores Públicos de Venezuela) mediante **Boletines de Adopción (BA VEN-NIF)**.
- Dos marcos: **VEN-NIF GE** (grandes entidades, NIIF completas) y **VEN-NIF PYME** (NIIF para PYMEs + boletines). Default del sistema: **VEN-NIF PYME**.
- **BA VEN-NIF 2**: criterios para aplicar **NIC 29 / Sección 31 (hiperinflación)** — reexpresión de estados financieros por inflación cuando la economía califica (criterio INPC/INPC estimado). Implicación: el sistema debe poder generar EEFF **históricos** y **reexpresados** (módulo de reexpresión con índices mensuales cargables como parámetros). Fase tardía, pero el modelo de datos guarda fecha de origen de cada partida no monetaria (requisito para reexpresar).
- Partidas **monetarias** (caja Bs, CxC Bs, CxP Bs) no se reexpresan pero generan **pérdida monetaria**; partidas **no monetarias** (inventario, activos fijos, patrimonio) se reexpresan por índice desde su fecha de origen.
- Moneda **funcional** vs de **presentación**: legalmente se presenta en Bs; gerencialmente muchas PYMEs operan de facto en USD. El sistema no obliga a elegir: mantiene ambas bases siempre (ver §4).

## 4. Motor multimoneda triple (el corazón del producto)

### 4.1 Modelo
Cada línea contable y cada línea de documento almacena **tres expresiones del mismo monto**:

```
currency_code      → moneda de la operación (VES, USD, EUR, USDT, ...)
amount_origin      → monto en moneda origen
rate_bcv           → tasa BCV Bs/USD (o Bs/divisa) de la FECHA DE OPERACIÓN, congelada
amount_ves         → base FISCAL: amount_origin × tasa correspondiente (es la verdad legal)
rate_mgmt          → tasa gerencial Bs/USD del día (default = BCV; configurable a paralelo/promedio)
amount_usd_mgmt    → base GERENCIAL: valor en USD para reportes del dueño
```

Reglas:
1. La tasa se asigna por **documento** (todas sus líneas comparten `exchange_rate_id`) en el momento de emisión/registro; jamás se recalcula después.
2. Si la operación es en VES: `amount_ves = amount_origin`; `amount_usd_mgmt = amount_origin / rate_mgmt`.
3. Si es en USD: `amount_usd_mgmt = amount_origin`; `amount_ves = amount_origin × rate_bcv`.
4. Otras divisas/cripto: se convierten vía su tasa BCV (o tasa de mercado configurada para cripto) a ambas bases.
5. La **suma de débitos = créditos debe cumplirse en las tres columnas**; las diferencias por redondeo (≤ el céntimo equivalente) se ajustan automáticamente contra cuentas de redondeo (4.7/6.7) y quedan trazadas.

### 4.2 Diferencial cambiario
- **Realizado**: una CxC en USD nace a tasa 250 y se cobra a tasa 270 → en la base VES surge una ganancia cambiaria (4.7); el asiento de cobro la registra automáticamente. Simétrico para CxP (pérdida 6.7).
- **No realizado (reexpresión de saldos)**: al cierre de cada mes, job que revaloriza saldos en divisas (caja USD, Zelle, USDT, CxC/CxP en divisas) a la tasa BCV de cierre, con asiento automático de ajuste reversible. En la base USD gerencial ocurre el efecto espejo sobre los saldos en Bs (la caja en Bs "pierde" valor en USD).
- Tratamiento fiscal del diferencial (gravable/deducible al realizarse) → etiquetar realizado vs no realizado para la conciliación fiscal ISLR. `TODO-TRIBUTARISTA: confirmar criterio vigente`.

### 4.3 Inventario en doble base
- Métodos: **costo promedio ponderado** (default, exigido por art. 177 Ley ISLR para el inventario fiscal) y FIFO opcional gerencial.
- Cada movimiento de inventario guarda costo unitario en VES y en USD; el kardex se puede consultar en ambas bases. El costo de venta se asienta en ambas simultáneamente.

## 5. Ciclo contable que el sistema automatiza

```
Documento (factura/compra/pago/nómina)
   → Asiento automático (plantillas de contabilización configurables por tipo de documento)
   → Libro Diario → Libro Mayor → Balance de comprobación
   → Ajustes de cierre mensual (diferencial no realizado, depreciación, provisiones laborales, prorrata IVA)
   → Estados financieros (Situación financiera, Resultados, Flujo de efectivo método indirecto, Cambios en el patrimonio)
   → Cierre del período (bloqueo) → Cierre anual (traslado de resultado a 3.4/3.3, reserva legal)
```

- **Asientos manuales**: permitidos solo para roles contador/admin, con líneas libres, siempre balanceados, adjuntos de soporte recomendados.
- **Plantillas de contabilización**: cada tipo de documento mapea a cuentas (ej.: factura de venta → débito Clientes, crédito Ventas por alícuota, crédito IVA débito fiscal). Editables por el contador; versiona­das.
- **Centros de costo** y **sucursales** como dimensiones opcionales de cada línea.

## 6. Estados financieros y reportes contables mínimos

Balance de comprobación (por nivel, por rango de fechas, ambas bases), Estado de situación financiera, Estado de resultados (mensual/acumulado, comparativo, por centro de costo, en Bs históricos / Bs reexpresados / USD), Flujo de efectivo, Mayor analítico por cuenta con drill-down al documento, Libro Diario legal y Libro Mayor legal (formatos imprimibles), Libro de Inventarios anual. Regla de oro: **cada cifra es clickeable hasta su documento origen.**

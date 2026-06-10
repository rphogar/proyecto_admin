# 01 — Visión del Producto

## 1. Qué es ContaVE

Sistema administrativo-contable-fiscal **cloud-native, multimoneda y por suscripción** para PYMEs venezolanas. Una sola captura de cada operación produce simultáneamente:

1. **El mundo fiscal (VES)**: factura legal, libros de compras/ventas, asientos en bolívares a tasa BCV, declaraciones de IVA/ISLR/IGTF, comprobantes de retención — lo que exige el SENIAT.
2. **El mundo gerencial (USD)**: utilidad real, márgenes, flujo de caja, cuentas por cobrar/pagar y valor de inventario en dólares — lo que el dueño hoy lleva en un Excel paralelo.

Posicionamiento: **"el Alegra que reemplaza a Gálac"** — todo el cumplimiento fiscal del software legacy, con arquitectura, UX y modelo de negocio modernos.

## 2. Usuarios y jobs-to-be-done

| Persona | Rol | Job-to-be-done principal |
|---|---|---|
| **El dueño** | Decide la compra. Usa el móvil. | "Saber cuánto gané de verdad (en USD) y cuánto hay en caja, sin esperar al contador." |
| **El contador externo** | Canal de distribución. Lleva 20–50 empresas. | "Cerrar el mes y declarar sin perseguir papeles ni retipear; gestionar todas mis empresas desde un panel." |
| **El administrador/cajero** | Usuario diario. | "Facturar rápido, cobrar en 4 monedas, que el sistema cuadre solo." |
| **El vendedor** | Móvil, a veces sin conexión. | "Tomar pedidos y consultar inventario y precios al día." |
| **El auditor/fiscal** | Esporádico. | "Ver libros, soportes y trazabilidad completa de cualquier cifra." |

## 3. Competencia y paridad mínima

Incumbentes: **Gálac** (módulos: Administrativo, Contabilidad, Nómina, IVA, ISLR), **Profit Plus**, **Saint**, **A2**, **Hybrid** (el competidor moderno más agresivo, ya homologado SENIAT). Todos nacieron desktop, bolívar-céntricos, con licencia por máquina y orientados al contador.

**Paridad obligatoria (todo lo que hace Gálac debe existir aquí):** facturación fiscal completa (facturas, NC, ND, guías de despacho), control de inventario con costo promedio y FIFO, cuentas por cobrar/pagar con antigüedad, bancos y conciliación, contabilidad de partida doble con plan de cuentas flexible, libros legales (diario, mayor, inventarios) y libros especiales de IVA (compras/ventas), retenciones de IVA e ISLR (como agente y como sujeto), declaraciones IVA/ISLR/IGTF con planillas, nómina LOTTT completa con parafiscales, activos fijos con depreciación, reportes y estados financieros, multi-empresa para contadores.

**Diferenciadores (ir más allá):**
1. Multimoneda triple nativa en cada transacción (no un "módulo de divisas" parchado).
2. Conciliación semi-automática de Pago Móvil, Zelle, punto de venta, efectivo USD y USDT.
3. Dashboard gerencial en USD en tiempo real, móvil-primero, para el dueño.
4. Portal multi-empresa para el contador con cierre mensual asistido (checklist + un clic por declaración).
5. Cloud multi-tenant, suscripción mensual en USD, sin instalación ni "respaldos en pendrive".
6. API abierta + webhooks (nadie en el mercado local la tiene).
7. Trazabilidad total: de cualquier cifra de un estado financiero se llega en 3 clics al documento origen y su soporte.
8. Arquitectura nativamente conforme a la Providencia 121 (inmutabilidad, event log, remisión) — diseñada para homologarse, no parchada.

## 4. Principios de diseño de producto

1. **Capturar una vez, producir ambos mundos.** Ninguna operación se registra dos veces.
2. **El contador es el canal; el dueño es el cliente.** Cada feature debe ahorrarle horas al contador o darle visibilidad al dueño. Idealmente ambas.
3. **Opinionated por defecto, flexible por configuración.** Plan de cuentas, impuestos y asientos automáticos vienen preconfigurados para el caso venezolano típico; todo es ajustable por el contador.
4. **A prueba de Venezuela.** Funciona con internet intermitente (PWA + cola offline en POS), con cortes de luz (transaccionalidad estricta), con tasas que cambian a diario y con normativa que cambia por Gaceta (parámetros con vigencia, no código).
5. **Nada de cifras mágicas.** Todo total es explicable: drill-down hasta el asiento y el documento.
6. **Español venezolano en toda la UI.** "Cobrar", "Pago Móvil", "RIF", "comprobante de retención" — el vocabulario del usuario, no traducciones genéricas.

## 5. Lo que NO es (anti-alcance v1)

- No es un ERP de manufactura (sin MRP, sin producción) — v1 es comercio y servicios.
- No es un sistema bancario ni custodia fondos; registra y concilia, no mueve dinero.
- No emite facturas fiscales válidas hasta obtener homologación SENIAT; mientras tanto opera como capa gerencial/contable y generador de pre-facturas/documentos no fiscales claramente marcados como tales.
- No asesora tributariamente: muestra cálculos y planillas borrador; la responsabilidad de declarar es del contribuyente y su contador.

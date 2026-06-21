# 13 — Factura digital (P24)

Régimen de **factura digital** bajo la **Providencia SNAT/2024/000102** (docs/02 §6.2, docs/05 §5,
docs/06 M12). Cubre la **emisión de facturas y documentos fiscales por medios digitales** con
**números de control digitales** asignados por una **imprenta digital autorizada**, su **entrega
electrónica** al adquirente y su **conservación** a disposición del SENIAT (10 años por COT).

> **Factura digital ≠ factura electrónica con validación en línea del SENIAT.** La 00102 (factura
> digital) asigna el número de control digital vía imprenta autorizada y entrega el documento. La
> factura electrónica con **acuse en tiempo real** del SENIAT aún no tiene canal técnico publicado; la
> arquitectura deja el camino preparado (ver "Validación en línea del SENIAT" abajo) pero **no la
> implementa**.

## Principio: la imprenta digital es un adapter

Igual que la impresora fiscal (P23) y la remisión al SENIAT (P17), la integración con la imprenta
digital autorizada es un **adapter limpio** (`ImprentaDigital`, punto de extensión único) en el paquete
reutilizable **`@contave/imprenta-digital`** (puro, testeable en CI con un adapter simulado). El SaaS
nunca habla directo con el proveedor: lo hace a través del adapter inyectado por token
(`IMPRENTA_DIGITAL`). Hoy `ImprentaDigitalSimulada`; mañana, el proveedor real, sin tocar el resto.

```
POST /facturacion-digital/emitir
   │ 1. valida 00071/00102 (salvo nº de control, que asigna la imprenta)
   │ 2. ImprentaDigital.asignarControl(...)  ─────────▶ nº de control digital
   │ 3. EmisionService.emitir(...) (consume serie, documento ISSUED inmutable, EMISION en bitácora)
   │ 4. arma el DocumentoDigital + control verificable (identificador/QR)
   └ 5. encola en digital_invoice_deliveries e intenta entrega + conservación
                                          │
            (contingencia: proveedor caído)│ backoff ──▶ POST /facturacion-digital/procesar
                                          ▼
            ImprentaDigital.entregar(...) ▶ ENTREGA  (evento en bitácora)
            ImprentaDigital.conservar(...) ▶ CONSERVACION (evento en bitácora)
```

## Numeración: software para el correlativo, imprenta para el control

A diferencia de la **máquina fiscal** (P23, donde el hardware asigna *todo* y la serie no se consume),
en el régimen digital:

- El **correlativo de la serie SÍ se consume** por software (numeración consecutiva sin huecos,
  docs/05 §4): `documents.number` lo asigna `EmisionService` con el contador transaccional.
- El **número de control** es **digital** y lo asigna la **imprenta autorizada**
  (`ImprentaDigital.asignarControl`) → `documents.control_number`, con `medio_emision =
  IMPRENTA_DIGITAL`.
- El documento queda **inmutable** (regla 4) ya con su número de control digital; las correcciones van
  por NC/ND.

## Control verificable (identificador / QR)

`construirControlVerificable` (puro, determinista) sella los campos fiscales clave del documento
(RIF del emisor, número de control, serie/número, fecha fiscal, RIF del adquirente, total en Bs, hash
de integridad) en un **identificador** (SHA-256) y arma una **URL de verificación** y el contenido del
**QR** que viajan con el documento entregado y conservado.

- `TODO-TRIBUTARISTA`: el **formato exacto** del identificador y del QR (algoritmo, campos, firma) está
  pendiente de la especificación oficial de la imprenta autorizada / del SENIAT. Está aislado tras esa
  función: cuando se publique, solo cambia esa construcción.
- `TODO-TRIBUTARISTA`: el **dominio oficial** de la URL de verificación (hoy `URL_VERIFICACION_DIGITAL`,
  parametrizable por entorno).

## Entrega y conservación (cola con reintentos)

Tras emitir, la entrega electrónica (correo u otro medio) y la conservación se gestionan en la cola
`digital_invoice_deliveries` (hermana de `fiscal_transmission_queue` y `fiscal_print_queue`):

- La **emisión no depende de la entrega**: si el proveedor está caído, el documento ya quedó emitido y
  la entrega queda `PENDIENTE` reintentándose con **backoff exponencial** (`cumplimiento/backoff.ts`)
  hasta `max_reintentos`, luego `ERROR`. La conservación tiene su propio estado (`conservacion_estado`).
- Cada éxito registra su evento en la bitácora encadenada: **`ENTREGA`** (entrega electrónica) y
  **`CONSERVACION`** (puesta a disposición del SENIAT), sumados a los tipos de `fiscal_event_log`.

## Endpoints

Todos bajo contexto de tenant y permisos `facturacion-digital.*` (seed 0067).

| Método | Endpoint | Cuerpo | Efecto |
| --- | --- | --- | --- |
| POST | `/facturacion-digital/emitir` | cuerpo de emisión (factura/NC/ND) + `entrega { canal, direccion? }` | Valida, **asigna el control digital**, emite (consume serie, ISSUED), arma el documento digital y **encola + intenta** entrega y conservación. |
| POST | `/facturacion-digital/procesar` | `{ limite? }` | Reprocesa entregas/conservaciones pendientes (contingencia) con `FOR UPDATE SKIP LOCKED`. |
| GET | `/facturacion-digital/cola` | query `companyId?`, `estado?` | Diagnóstico de la cola. |

`medioEmision` se fuerza a `IMPRENTA_DIGITAL`. La dirección de entrega sale de `entrega.direccion` o,
si falta y el canal es `EMAIL`, del `email` del tercero.

- `TODO-TRIBUTARISTA`: la **obligatoriedad** del régimen digital (ventas por **medios electrónicos**:
  e-commerce, redes sociales, plataformas) y su escalonamiento por tipo de contribuyente dependen de la
  providencia. Hoy la emisión digital es **opt-in** por endpoint; no se fuerza automáticamente según el
  canal de venta.

## Validación en línea del SENIAT (preparada, no implementada)

El paquete declara el **punto de integración futuro** `ValidacionEnLineaSeniat` (`seniat/
validacion-en-linea.ts`) para la **factura electrónica con acuse en tiempo real**: un adapter
**síncrono y bloqueante** (sin acuse válido no se emite, a diferencia de la remisión asíncrona de P17).
Su única implementación hoy es `ValidacionEnLineaNoDisponible` (devuelve `NO_DISPONIBLE`). **No está
cableada** en el flujo de emisión. Cuando el SENIAT publique el canal técnico, se implementa esa
interfaz y se inserta el paso de validación previo a la emisión; el resto del flujo no cambia.

## Paquete `@contave/imprenta-digital`

- `ImprentaDigital` (adapter): `asignarControl` (nº de control digital), `entregar` (entrega
  electrónica), `conservar` (conservación). Uniones discriminadas que **no lanzan**
  (`ASIGNADO`/`ENTREGADO`/`CONSERVADO` | `REINTENTABLE` | `PERMANENTE`).
- `construirControlVerificable` (identificador + QR + URL de verificación, puro y determinista).
- `construirDocumentoDigital` (representación con requisitos 00071 + control digital, serializable).
- `ImprentaDigitalSimulada` (imprenta en memoria; default en CI y en el SaaS sin proveedor integrado;
  modos `caer()`/`rechazar()`/`reparar()` para tests de contingencia).
- `ValidacionEnLineaSeniat` / `ValidacionEnLineaNoDisponible` (punto de integración futuro).
- `TODO-TRIBUTARISTA`: formato del número de control digital y del control verificable, y obligatoriedad
  del régimen — todos aislados tras el adapter / las funciones puras.

## El proveedor real (pendiente)

Cuando se integre una imprenta digital autorizada, el único componente nuevo es la **implementación del
adapter** `ImprentaDigital` contra su API (asignación de control, entrega, conservación). La cola, los
reintentos, la bitácora y el documento digital ya existen.

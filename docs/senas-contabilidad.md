# Señas: contabilidad en Caja, Inicio, cierre y reportes

## Próxima caja abierta (11/11/2026)

Reemplaza la "extensión de la caja cerrada" de la sección siguiente:

- La seña aprobada entra en la **primera caja abierta desde el día de la transferencia**.
  - Caja de ese día sin cerrar → queda en ese día.
  - Caja de ese día ya cerrada, o el local no abrió (día no laborable según Horarios, o cierre de Agenda) → pasa al siguiente día con caja abierta. Ej.: seña del domingo → lunes; seña aprobada después de cerrar el lunes → martes.
- `credited_at` conserva el día real de la transferencia: el cierre avisa "Incluye 1 seña del domingo" y la tarjeta de Señas avisa cuando una seña entra en una caja futura.
- Tarjeta de Señas: "Por revisar" (comprobantes) y "Reembolsos por revisar" (turnos con seña cancelados dentro del plazo de cancelación; se resuelven desde el turno en Agenda). Fuera de plazo el cliente no puede cancelar desde su link.
- Base: `_caja_dia_abierto` + `_deposit_cash_movements` (migración `20261111010000_senas_proxima_caja_abierta.sql`).

## Nueva forma (10/11/2026) — reemplaza lo que diga distinto más abajo

- La seña con comprobante queda **Por revisar**. Al aprobarla, el ingreso (`cash_movements.created_at`) queda en el
  **día de la transferencia** (`credited_at`), en **Dinero en banco**. Efectivo / cargada a mano desde Agenda: queda
  aprobada en el momento (efectivo → **Efectivo en caja**, transferencia → Dinero en banco).
- Día de la transferencia **sin caja** (domingo, feriado): ese día aparece como **caja pendiente de cierre**
  (`datesWithActivity` cuenta los movimientos de seña).
- Día de la transferencia con la **caja ya cerrada**: el movimiento queda con `extension_pendiente = true` y no entra en
  ningún cierre ni en la caja abierta. Aparece el aviso **"Señas pendientes de cierre"** (Inicio y Caja); al confirmarlo,
  `close_caja_extension_v1` crea una fila en `caja_cierre_extensiones` y el Historial la muestra debajo del cierre.
  El cierre original no se modifica.
- **No se puede confirmar un cierre** con señas por revisar cuyo comprobante es de ese día o anterior (`CierreSenasGate`).
- **Reembolso**: ya no es un retiro de caja. `decide_deposit_v1(..., p_funds_source)` crea un **gasto del día**
  ("Reembolso de seña", tipo ocasional, `expenses.deposit_id`) con origen Caja (`caja`) o Fondos externos (`otros`).
  Se hace desde Agenda, en el turno.
- Tarjeta "Señas" (Inicio y Caja): solo **Por revisar**.
- Migración: `supabase/migrations/20261110030000_senas_dia_transferencia_y_extension.sql`.

## Fechas que guarda cada seña
- `credited_at` — fecha REAL de acreditación (día que el cliente transfirió; efectivo/registrada a mano: el momento).
- `approved_at` — fecha de aprobación en el local.
- Ambas también en `cash_movements` (`created_at` = aprobación, `credited_at` = acreditación). Una seña aprobada
  **nunca** se fecha en un día anterior: no se reabre ni modifica una caja cerrada.

## Reglas
| Concepto | Regla |
|---|---|
| Señas (tarjeta) | "Recibidas": todas las aprobadas en el día, sin importar qué día transfirió el cliente. "Devueltas": las devueltas en el día. |
| Ingresos del día | Señas aprobadas ese día − señas devueltas ese día + ventas (sin la parte pagada como seña). |
| Dinero en cuenta del día | La seña suma el día en que se aprueba (decisión del 9/11/2026: al cerrar se recomienda pasar el dinero a otra cuenta y arrancar en 0). Si la transferencia es de otro día, el cierre de dinero en cuenta lo avisa: "2 señas del domingo". |
| Venta con seña | Se registra por el total; la parte `sena` no vuelve a contar como ingreso ni como dinero recibido. |
| Total mensual de transferencias | Por `credited_at` (fecha real), sin duplicar, aunque la caja de ese día esté cerrada. Distinto del total de ingresos del mes. |
| Conciliación | Lista las señas acreditadas en días cerrados: explican la diferencia entre el total mensual y la suma de los cierres diarios. |
| Cierres históricos | No se modifican. |

Ejemplo: hoy apruebo $100.000 (50.000 hoy + 50.000 del domingo) → señas aprobadas 100.000; ingresos por señas 100.000;
dinero en cuenta por señas 100.000; el cierre avisa "1 seña del domingo" y lista ambas con su etiqueta; la caja del domingo no cambia.

## Implementación por etapas
1. **Datos** (migración `20261109080000_senas_fechas_acreditacion.sql`) y reglas puras (`src/lib/senas-contable.ts`, con pruebas).
2. **Dinero en cuenta**: la seña suma el día de la aprobación (no se filtra nada); `senaCreditedOtherDay` solo alimenta el aviso.
3. **Ingresos**: `use-caja-summary`, `use-caja-data`, dashboard/Inicio y `caja-cierre` usan `saleIngreso` y suman `senasIngresosDelDia`.
4. **Tarjeta "Señas"** (Recibidas / Devueltas); **cierre**: señas con su etiqueta en el detalle y aviso en dinero en cuenta de las transferidas otro día (`senasOtroDiaAviso`).
5. **Reportes**: total mensual de transferencias por fecha de acreditación + conciliación con los cierres.

## Impacto sobre cálculos existentes (a revisar antes de cada etapa)
- `src/lib/caja-cierre.ts` (cierre, esperado, conciliación) — 155 pruebas.
- `src/hooks/use-caja-summary.ts` (Ingresos y dinero del día en Caja e Inicio).
- `src/components/cash-register/use-caja-data.ts`, `src/components/dashboard/*`.
- `src/routes/reports.tsx` (facturación mensual por medio de pago).
- Cada etapa se prueba en una copia aislada con datos reales antes de tocar producción.

## Dinero en cuenta arranca en 0 después de cada cierre (9/11/2026)

Antes el saldo esperado de la cuenta partía de lo que había quedado en el último cierre (`getDigitalCarryForward`).
Ahora no se arrastra: cada período cuenta solo lo que entró y salió desde el último cierre, y el cierre muestra la
recomendación de pasar el dinero a otra cuenta y dejarla en $0. Los cierres ya hechos no se modifican.

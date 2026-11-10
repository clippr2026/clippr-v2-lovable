# Señas: contabilidad en Caja, Inicio, cierre y reportes

## Fechas que guarda cada seña
- `credited_at` — fecha REAL de acreditación (día que el cliente transfirió; efectivo/registrada a mano: el momento).
- `approved_at` — fecha de aprobación en el local.
- Ambas también en `cash_movements` (`created_at` = aprobación, `credited_at` = acreditación). Una seña aprobada
  **nunca** se fecha en un día anterior: no se reabre ni modifica una caja cerrada.

## Reglas
| Concepto | Regla |
|---|---|
| Señas aprobadas (tarjeta) | Un único total: todas las aprobadas en el día. Detalle con etiqueta "Seña de hoy" / "Seña del domingo"… |
| Ingresos del día | Señas aprobadas ese día − señas devueltas ese día + ventas (sin la parte pagada como seña). |
| Dinero en cuenta del día | Solo transferencias acreditadas ese día. Una seña acreditada otro día no suma. |
| Venta con seña | Se registra por el total; la parte `sena` no vuelve a contar como ingreso ni como dinero recibido. |
| Total mensual de transferencias | Por `credited_at` (fecha real), sin duplicar, aunque la caja de ese día esté cerrada. Distinto del total de ingresos del mes. |
| Conciliación | Lista las señas acreditadas en días cerrados: explican la diferencia entre el total mensual y la suma de los cierres diarios. |
| Cierres históricos | No se modifican. |

Ejemplo: hoy apruebo $100.000 (50.000 hoy + 50.000 del domingo) → señas aprobadas 100.000; ingresos por señas 100.000;
dinero en cuenta por señas 50.000; en el cierre, filtro Transferencias muestra ambas con su etiqueta; la caja del domingo no cambia.

## Implementación por etapas
1. **Datos** (migración `20261109080000_senas_fechas_acreditacion.sql`) y reglas puras (`src/lib/senas-contable.ts`, con pruebas).
2. **Dinero en cuenta**: `computeExpectedCashAndDigital` y los resúmenes ignoran movimientos de señas acreditadas otro día
   (`senaCreditedOtherDay`).
3. **Ingresos**: `use-caja-summary`, `use-caja-data`, dashboard/Inicio y `caja-cierre` usan `saleIngreso` y suman `senasIngresosDelDia`.
4. **Tarjeta "Señas aprobadas"** y detalle con etiquetas; **cierre** con filtro Transferencias mostrando las señas (las de otros días solo informativas).
5. **Reportes**: total mensual de transferencias por fecha de acreditación + conciliación con los cierres.

## Impacto sobre cálculos existentes (a revisar antes de cada etapa)
- `src/lib/caja-cierre.ts` (cierre, esperado, conciliación) — 155 pruebas.
- `src/hooks/use-caja-summary.ts` (Ingresos y dinero del día en Caja e Inicio).
- `src/components/cash-register/use-caja-data.ts`, `src/components/dashboard/*`.
- `src/routes/reports.tsx` (facturación mensual por medio de pago).
- Cada etapa se prueba en una copia aislada con datos reales antes de tocar producción.

# Señas: contabilidad en Caja, Inicio, cierre y reportes

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

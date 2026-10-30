-- ============================================================================
-- Gastos: "Origen del dinero" (Caja del día / Otros fondos) y tipo Fijo/Variable/Ocasional
-- ============================================================================
-- Nuevo gasto pasa a pedir: tipo (fijo | variable | ocasional), nombre libre,
-- monto, origen del dinero y medio de pago (efectivo | transferencia).
--   · 'caja'  — Caja del día: sale del efectivo o del dinero en cuenta (según el
--               medio): entra en el cierre.
--   · 'otros' — Otros fondos (reserva, bolsillo del dueño, otra cuenta): el gasto
--               se registra y cuenta UNA vez en reportes/utilidad, pero NO baja
--               Efectivo del día, Dinero en cuenta del día ni el cierre.
--
-- Reutiliza la tabla expenses: name = nombre del gasto, type = tipo nuevo,
-- note = nota. 'category' queda como está (gastos históricos con Alquiler,
-- Insumos, etc.): NO se toca ni se reclasifica ninguna fila existente.
--
-- Compatibilidad: funds_source queda en NULL para (a) todos los gastos
-- históricos y (b) quien no lo manda (la app anterior, la devolución de seña
-- de Agenda): NULL se trata como 'caja', exactamente como hasta hoy. No hay
-- DEFAULT justamente para no alterar esos inserts.
--
-- Validación en backend (inserts directos incluidos, la tabla tiene RLS para
-- clientes): si el gasto trae origen, es un gasto del formulario nuevo y debe
-- cumplir: tipo fijo/variable/ocasional, nombre no vacío, monto > 0 y medio
-- efectivo/transferencia. El origen no se puede cambiar una vez registrado.
--
-- Cómo revertirlo (no toca ningún dato de gastos):
--   drop trigger trg_expenses_funds_source_immutable on public.expenses;
--   drop function public.expenses_funds_source_immutable();
--   alter table public.expenses drop constraint expenses_funds_source_check,
--                               drop constraint expenses_new_form_valid;
--   (la columna funds_source puede quedar: sin la app nueva no se usa)
-- ============================================================================

alter table public.expenses
  add column if not exists funds_source text;

alter table public.expenses drop constraint if exists expenses_funds_source_check;
alter table public.expenses
  add constraint expenses_funds_source_check
  check (funds_source is null or funds_source in ('caja', 'otros'));

alter table public.expenses drop constraint if exists expenses_new_form_valid;
alter table public.expenses
  add constraint expenses_new_form_valid
  check (
    funds_source is null
    or (
      coalesce(type, '') in ('fijo', 'variable', 'ocasional')
      and nullif(trim(name), '') is not null
      and amount > 0
      and coalesce(lower(payment_method), '') in ('efectivo', 'transferencia')
    )
  );

comment on column public.expenses.funds_source is
  'Origen del dinero: caja (Caja del día, entra en el cierre) | otros (Otros fondos, no toca la caja). NULL = histórico/anterior, tratado como caja.';

create or replace function public.expenses_funds_source_immutable()
returns trigger language plpgsql as $$
begin
  if new.funds_source is distinct from old.funds_source then
    raise exception 'El origen de un gasto no se puede cambiar una vez registrado';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_expenses_funds_source_immutable on public.expenses;
create trigger trg_expenses_funds_source_immutable
  before update on public.expenses
  for each row execute function public.expenses_funds_source_immutable();

notify pgrst, 'reload schema';

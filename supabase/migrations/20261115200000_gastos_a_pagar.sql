-- Gastos a pagar: compras que se pagan más adelante, con fecha de vencimiento.
--
-- Hoy un gasto se carga cuando ya se pagó y descuenta en el momento. No había forma de anotar "compré productos o bebidas y los
-- pago el 20/11".
-- Cambio:
--   1. Tabla nueva payable_expenses (gastos a pagar): concepto, monto, vencimiento, proveedor, nota y estado (pendiente/pagado).
--      Mientras está pendiente NO cuenta como gasto: no baja la caja ni mueve reportes ni cierres. Solo la ven y la modifican los
--      miembros del negocio (mismo criterio que la tabla de gastos).
--   2. Función pay_payable_expense_v1: al pagar, crea el gasto normal (con la fecha de hoy del local, el medio y el origen de la plata)
--      y marca la deuda como pagada, vinculada a ese gasto, todo junto o nada.
-- No modifica ninguna fila existente: agrega una tabla y una función.
-- Cómo revertirlo: drop function public.pay_payable_expense_v1(uuid, text, text, text); drop table public.payable_expenses;

create table if not exists public.payable_expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid,
  name text not null check (btrim(name) <> '' and length(name) <= 120),
  amount numeric not null check (amount > 0),
  kind text,
  supplier text check (supplier is null or length(supplier) <= 120),
  due_date date not null,
  note text check (note is null or length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_expense_id uuid references public.expenses(id) on delete set null,
  paid_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists payable_expenses_business_status_due_idx
  on public.payable_expenses (business_id, status, due_date);

alter table public.payable_expenses enable row level security;

drop policy if exists payable_expenses_member_all on public.payable_expenses;
create policy payable_expenses_member_all on public.payable_expenses
  for all to authenticated
  using (public.user_is_business_member(business_id))
  with check (public.user_is_business_member(business_id));

revoke all on public.payable_expenses from anon, public;
grant select, insert, update, delete on public.payable_expenses to authenticated;

create or replace function public.pay_payable_expense_v1(
  p_id uuid,
  p_funds_source text,
  p_method text,
  p_user text default null
)
returns uuid
language plpgsql
as $$
declare
  a public.payable_expenses%rowtype;
  v_expense uuid;
  v_tz text;
begin
  if p_funds_source not in ('caja', 'otros') then
    raise exception 'Elegí de dónde sale la plata: caja del día o fondos externos.';
  end if;
  if p_method not in ('efectivo', 'transferencia') then
    raise exception 'Elegí con qué medio se pagó: efectivo o transferencia.';
  end if;

  select * into a from public.payable_expenses where id = p_id and status = 'pending' for update;
  if not found then
    raise exception 'El gasto a pagar no existe o ya fue pagado.';
  end if;

  select coalesce(b.timezone, 'America/Argentina/Buenos_Aires') into v_tz from public.businesses b where b.id = a.business_id;

  insert into public.expenses (business_id, branch_id, name, amount, type, payment_method, funds_source, date, note, user_name, created_by)
  values (
    a.business_id, a.branch_id, a.name, a.amount, a.kind, p_method, p_funds_source,
    (now() at time zone coalesce(v_tz, 'America/Argentina/Buenos_Aires'))::date,
    nullif(concat_ws(' · ', 'Pago de compra a plazo', nullif(btrim(coalesce(a.supplier, '')), ''), nullif(btrim(coalesce(a.note, '')), '')), ''),
    p_user, p_user
  )
  returning id into v_expense;

  update public.payable_expenses set status = 'paid', paid_expense_id = v_expense, paid_at = now() where id = a.id;
  return v_expense;
end;
$$;

revoke all on function public.pay_payable_expense_v1(uuid, text, text, text) from public, anon;
grant execute on function public.pay_payable_expense_v1(uuid, text, text, text) to authenticated;

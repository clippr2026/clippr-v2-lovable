-- «No avisar más» de un saldo pendiente, para todos los dispositivos del local.
-- Solo agrega una tabla. No cambia ventas, cobros, Caja ni ninguna otra tabla: la deuda sigue igual.
create table public.debt_notice_mutes (
  payment_id uuid primary key references public.payments (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  muted_by uuid default auth.uid(),
  muted_at timestamptz not null default now()
);
create index debt_notice_mutes_business_idx on public.debt_notice_mutes (business_id);

alter table public.debt_notice_mutes enable row level security;
revoke all on public.debt_notice_mutes from public, anon, authenticated;
grant select, insert, delete on public.debt_notice_mutes to authenticated;

create policy debt_notice_mutes_select on public.debt_notice_mutes
  for select to authenticated using (public.user_is_business_member(business_id));
create policy debt_notice_mutes_insert on public.debt_notice_mutes
  for insert to authenticated with check (
    public.user_is_business_member(business_id)
    and exists (select 1 from public.payments p where p.id = payment_id and p.business_id = debt_notice_mutes.business_id)
  );
create policy debt_notice_mutes_delete on public.debt_notice_mutes
  for delete to authenticated using (public.user_is_business_member(business_id));

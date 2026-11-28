-- Venta del 26/11 que no contó la seña ($10.950). El dueño confirmó que el cliente no debe nada: la venta queda en
-- $20.950 (seña $10.950 + $10.000), cobrada, con la comisión completa. No mueve plata de Caja.
-- Se detiene si la venta ya no está como cuando se revisó.
do $$
declare
  v_id constant uuid := '9b0b7db1-4d4a-4600-a5f4-29698074a26c';
  p record;
  c record;
  v_sena numeric;
  v_cobro uuid;
  v_total numeric;
  v_comision numeric;
begin
  select * into p from public.payments where id = v_id for update;
  if p.id is null or p.status <> 'parcial' or p.total <> 21000 or p.collected_amount <> 10000 or p.discount <> 900 then
    raise exception 'La venta cambió desde la revisión: no se corrige';
  end if;
  select paid_amount into v_sena from public.appointment_deposits where appointment_id = p.appointment_id and status = 'applied';
  if v_sena is distinct from 10950 then
    raise exception 'La seña no coincide: no se corrige';
  end if;
  select id into v_cobro from public.payment_collections where payment_id = v_id order by collected_at limit 1;
  if v_cobro is null then
    raise exception 'No se encontró el cobro: no se corrige';
  end if;
  v_total := p.collected_amount + v_sena;

  update public.payments
    set total = v_total,
        amount = v_total,
        discount = p.discount + (p.total - v_total),
        collected_amount = v_total,
        status = 'cobrado',
        -- Mismo formato que un cobro completo con seña: la parte "sena" no vuelve a contar como plata recibida.
        splits = jsonb_build_array(
          jsonb_build_object('method', 'sena', 'amount', v_sena),
          jsonb_build_object('method', coalesce(p.method, p.payment_method), 'amount', p.collected_amount))
    where id = v_id;

  select * into c from public.commission_records where sale_id = v_id for update;
  if c.id is not null then
    v_comision := c.amount - c.paid_amount;
    if v_comision > 0 then
      -- Con fecha de hoy: entra en la próxima liquidación aunque ya haya habido una después de la venta.
      insert into public.commission_collection_events (business_id, commission_record_id, payment_collection_id, amount, collected_at)
      values (p.business_id, c.id, v_cobro, v_comision, now());
      update public.commission_records set paid_amount = c.amount where id = c.id;
    end if;
  end if;
end $$;

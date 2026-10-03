-- Comprobantes de transferencia: la imagen queda vinculada al pago
-- específico (payments.id), nunca al cliente ni al turno. Solo se guarda
-- el path de Storage — nunca una URL pública ni base64 en la base.
alter table public.payments add column if not exists receipt_path text;
-- Constancia de que existió un comprobante y se borró por retención (2
-- meses) — nunca se borra el pago ni el resto del historial, solo la
-- imagen.
alter table public.payments add column if not exists receipt_deleted_at timestamptz;

-- Bucket privado — a diferencia de "professionals"/"business-assets"
-- (públicos, ver equipo-section.tsx/branding-section.tsx), los
-- comprobantes pueden contener datos sensibles: nunca getPublicUrl,
-- siempre createSignedUrl bajo demanda.
insert into storage.buckets (id, name, public)
values ('payment-receipts', 'payment-receipts', false)
on conflict (id) do nothing;

-- Aislamiento por negocio: el primer segmento del path tiene que ser el
-- business_id del usuario autenticado (resuelto server-side vía
-- profiles, nunca confiado del lado del cliente) — mismo patrón que
-- cash_movements_write (20260930050000_caja_vencida_y_movimientos.sql).
-- Además, por pedido explícito: no alcanza con que el folder "diga" el
-- business_id correcto — el EXISTS valida que el payment_id codificado en
-- el nombre de archivo (payment_id.webp) pertenezca REALMENTE a ese
-- negocio en `payments`, no solo que el cliente lo haya escrito así.
drop policy if exists payment_receipts_select on storage.objects;
create policy payment_receipts_select on storage.objects
  for select
  using (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select p.business_id::text from public.profiles p where p.id = auth.uid())
    and exists (
      select 1 from public.payments pay
      where pay.id::text = split_part(storage.filename(name), '.', 1)
        and pay.business_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists payment_receipts_insert on storage.objects;
create policy payment_receipts_insert on storage.objects
  for insert
  with check (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select p.business_id::text from public.profiles p where p.id = auth.uid())
    and exists (
      select 1 from public.payments pay
      where pay.id::text = split_part(storage.filename(name), '.', 1)
        and pay.business_id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists payment_receipts_update on storage.objects;
create policy payment_receipts_update on storage.objects
  for update
  using (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select p.business_id::text from public.profiles p where p.id = auth.uid())
  );

drop policy if exists payment_receipts_delete on storage.objects;
create policy payment_receipts_delete on storage.objects
  for delete
  using (
    bucket_id = 'payment-receipts'
    and (storage.foldername(name))[1] = (select p.business_id::text from public.profiles p where p.id = auth.uid())
  );

grant select, insert, update, delete on storage.objects to authenticated;
